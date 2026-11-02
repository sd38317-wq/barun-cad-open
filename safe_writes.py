"""Shared file-save transaction: reserve before confirmation, commit after conversion.

The sidecar is shared by all local app processes. Old sidecars are never stolen:
an expired timestamp does not prove a converter or another process has stopped.
External non-cooperating writers are detected by stat immediately before replace;
the filesystem does not expose an atomic compare-version-and-replace operation.
"""
import json
import os
import stat
import tempfile
import time
import threading
from functools import wraps

def _serialized(method):
    @wraps(method)
    def guarded(self,*args,**kwargs):
        with self._commit_lock:return method(self,*args,**kwargs)
    return guarded
from pathlib import Path

import file_care


class SaveBusy(ValueError):
    pass


class SaveConflict(ValueError):
    pass


def lock_path(target):
    path = Path(target).expanduser().resolve()
    return path.with_name(path.name + '.barun-save.lock')


def file_version(target):
    try:
        value = Path(target).stat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(value.st_mode):
        raise ValueError('저장 대상은 일반 파일이어야 합니다.')
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
            value.st_ctime_ns, value.st_nlink)


class SaveTransaction:
    def __init__(self, target, assert_current=None):
        self.target = Path(target).expanduser().resolve()
        self.lock_path = lock_path(self.target)
        self.assert_current = assert_current
        self.version = None
        self.existed = False
        self._fd = None
        self._lock_identity = None
        self._committed = False
        self._commit_lock = threading.RLock()
        self.timings_ms = {}
        self.backup_method = 'none'
        self.replace_attempts = 0

    def __enter__(self):
        started = time.perf_counter()
        if self._fd is not None or self._committed:
            raise RuntimeError('저장 예약을 재사용할 수 없습니다.')
        if self.assert_current:
            self.assert_current()
        try:
            self._fd = os.open(self.lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            stale = False
            try:
                info = json.loads(self.lock_path.read_text(encoding='utf-8'))
                stale = time.time() - float(info.get('created', 0)) > 3600
            except (OSError, ValueError, TypeError):
                pass
            label = 'stale lock; ' if stale else ''
            raise SaveBusy(label + '다른 저장이 이 파일을 사용 중입니다. 잠금을 자동으로 삭제하지 않습니다.') from None
        try:
            value = os.fstat(self._fd)
            self._lock_identity = (value.st_dev, value.st_ino)
            with os.fdopen(os.dup(self._fd), 'w', encoding='utf-8') as stream:
                json.dump({'pid': os.getpid(), 'created': time.time()}, stream)
                stream.flush()
                os.fsync(stream.fileno())
            self.version = file_version(self.target)
            self.existed = self.version is not None
            self.timings_ms['reserve'] = round((time.perf_counter() - started) * 1000, 3)
            return self
        except BaseException:
            self.close()
            raise

    def assert_unchanged(self):
        if self._fd is None or self._committed:
            raise RuntimeError('유효한 저장 예약이 없습니다.')
        if file_version(self.target) != self.version:
            raise SaveConflict('확인 후 저장 대상 파일이 바뀌어 저장하지 않았습니다. 파일을 다시 확인하세요.')

    def _check(self, assert_current=None):
        self.assert_unchanged()
        if self.assert_current:
            self.assert_current()
        if assert_current and assert_current is not self.assert_current:
            assert_current()
        # A callback can wait for server authorization; check the file again afterward.
        self.assert_unchanged()

    @_serialized
    def save(self, data, assert_current=None):
        self._check(assert_current)
        started = time.perf_counter()
        fd, temporary = tempfile.mkstemp(prefix='.cad-', dir=self.target.parent)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)
                stream.flush()
                # commit_temp syncs the closed temporary before any backup or replace.
            self.timings_ms['temp_write'] = round((time.perf_counter() - started) * 1000, 3)
            result = self.commit_temp(temporary, assert_current=assert_current)
            self.timings_ms['save_total'] = round((time.perf_counter() - started) * 1000, 3)
            return result
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    @_serialized
    def commit_temp(self, temporary, assert_current=None):
        temporary = Path(temporary).resolve()
        if temporary.parent != self.target.parent or temporary == self.target:
            raise ValueError('저장 임시 파일은 대상과 같은 폴더의 별도 파일이어야 합니다.')
        started = time.perf_counter()
        self.timings_ms.setdefault('temp_write', 0.0)  # An external writer supplied the temporary.
        try:
            result = self._commit_temp(temporary, assert_current)
            self.timings_ms['save_total'] = round((time.perf_counter() - started) * 1000, 3)
            return result
        finally:
            if temporary.exists():
                temporary.unlink()

    def _commit_temp(self, temporary, assert_current):
        self._check(assert_current)
        started = time.perf_counter()
        with temporary.open('r+b') as stream:
            os.fsync(stream.fileno())
            size = os.fstat(stream.fileno()).st_size
        self.timings_ms['temp_sync'] = round((time.perf_counter() - started) * 1000, 3)
        started = time.perf_counter()
        if self.existed:
            how = file_care.keep_previous(self.target)
            self.backup_method = how
            if how is None:
                raise OSError('이전 파일 백업을 보존할 수 없어 저장을 중단했습니다.')
            if how == 'link':
                # POSIX hard-link creation itself changes ctime/link-count. Only
                # accept that metadata transition; content/identity still must match.
                after = file_version(self.target)
                before = self.version
                if (after is not None and after[:4] == before[:4]
                        and after[5] == before[5] + 1):
                    self.version = after
        self.timings_ms['backup'] = round((time.perf_counter() - started) * 1000, 3)
        started = time.perf_counter()
        for attempt in range(len(file_care.RETRY_DELAYS) + 1):
            self._check(assert_current)
            try:
                self.replace_attempts = attempt + 1
                os.replace(temporary, self.target)
                break
            except OSError as error:
                if attempt >= len(file_care.RETRY_DELAYS) or not file_care._is_retryable(error):
                    raise
                time.sleep(file_care.RETRY_DELAYS[attempt])
        self.timings_ms['replace'] = round((time.perf_counter() - started) * 1000, 3)
        self._committed = True
        if os.name != 'nt':
            directory = os.open(self.target.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        return {'path': str(self.target), 'bytes': size, 'timings_ms': self.timings_ms,
                'backup_method': self.backup_method, 'replace_attempts': self.replace_attempts}

    @_serialized
    def close(self):
        if self._fd is None:
            return
        os.close(self._fd)
        self._fd = None
        try:
            current = self.lock_path.stat()
            if (current.st_dev, current.st_ino) == self._lock_identity:
                self.lock_path.unlink()
        except FileNotFoundError:
            pass

    def __exit__(self, kind, value, traceback):
        self.close()


def reserve(target, assert_current=None):
    """Enter before asking overwrite confirmation; keep entered through commit."""
    return SaveTransaction(target, assert_current=assert_current)
