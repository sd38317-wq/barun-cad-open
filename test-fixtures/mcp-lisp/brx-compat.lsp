; BRX 요구 함수 호환 시험용. 결과A3.md의 원문을 복제한 파일은 아니다.
(defun brx:vertices (data)
  (vl-remove-if 'null
    (mapcar '(lambda (pair) (if (= (car pair) 10) (cdr pair))) data)))
(defun c:BRX (/ ss i en data pts a b c d mid r ang made)
  (setq ss (ssget "_I" '((0 . "LWPOLYLINE"))) i 0 made 0)
  (if ss
    (repeat (sslength ss)
      (setq en (ssname ss i) data (entget en) i (1+ i))
      (if (= 1 (logand 1 (cdr (assoc 70 data))))
        (progn
          (setq pts (mapcar '(lambda (p) (trans p en 0)) (brx:vertices data)))
          (if (= 4 (length pts))
            (progn
              (setq a (nth 0 pts) b (nth 1 pts) c (nth 2 pts) d (nth 3 pts))
              (if (and (equal (mapcar '+ a c) (mapcar '+ b d) 1e-6)
                       (equal (distance a c) (distance b d) 1e-6))
                (progn
                  (setq mid (mapcar '(lambda (x y) (/ (+ x y) 2.0)) a c)
                        r (* 0.25 (distance a c)) ang (angle mid c))
                  (entmake (list '(0 . "LINE") (cons 10 (polar mid ang r)) (cons 11 (polar mid (+ ang pi) r))))
                  (setq ang (angle mid d))
                  (entmake (list '(0 . "LINE") (cons 10 (polar mid ang r)) (cons 11 (polar mid (+ ang pi) r))))
                  (setq made (+ made 2))))))))))
  (princ made)
  (princ))
