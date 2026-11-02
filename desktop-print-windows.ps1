$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
public sealed class BarunPrinter : IDisposable {
 [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool OpenPrinter(string name,out IntPtr handle,IntPtr defaults);
 [DllImport("winspool.drv", SetLastError=true)] static extern bool ClosePrinter(IntPtr handle);
 [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetPrinter(IntPtr handle,int level,IntPtr buffer,int size,out int needed);
 [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool SetPrinter(IntPtr handle,int level,IntPtr info,int command);
 [DllImport("winspool.drv", CharSet=CharSet.Unicode)] static extern int DocumentProperties(IntPtr hwnd,IntPtr handle,string name,IntPtr output,IntPtr input,int mode);
 [DllImport("winspool.drv", CharSet=CharSet.Unicode)] static extern int DeviceCapabilities(string name,string port,short capability,IntPtr output,IntPtr devmode);
 public sealed class Paper { public int Id; public string Name; public int Width; public int Height; }
 IntPtr handle; string name; byte[] original; bool changed; Mutex gate; bool ownsGate;
 // Console.In is a SyncTextReader on Windows PowerShell: its ReadLineAsync
 // blocks synchronously. Keep reading on a worker so the watchdog can run.
 public static Task<string> ReadCommand() { return Task.Run(()=>Console.ReadLine()); }
 public BarunPrinter(string printer) {
  name=printer;
  using(var hash=SHA256.Create()) {
   string key=BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(WindowsIdentity.GetCurrent().User.Value+"|"+name.ToUpperInvariant()))).Replace("-","");
   gate=new Mutex(false,"Local\\BarunCADPrint-"+key);
  }
  try {
   try { ownsGate=gate.WaitOne(0); } catch(AbandonedMutexException) { ownsGate=true;throw new Exception("이전 인쇄 설정 작업이 비정상 종료됐습니다. 프린터 인쇄 기본 설정을 확인하세요."); }
   if(!ownsGate)throw new Exception("다른 바른 CAD에서 이 프린터로 인쇄 중입니다. 완료 후 다시 시도하세요.");
   if(!OpenPrinter(name,out handle,IntPtr.Zero))throw WinError("프린터 열기");
   original=ReadMode();
  } catch { Dispose();throw; }
 }
 static Exception WinError(string operation) { return new Exception(operation+" 실패: "+new Win32Exception(Marshal.GetLastWin32Error()).Message); }
 static byte[] CopyMode(IntPtr p) {
  if(p==IntPtr.Zero)return null;
  int size=(ushort)Marshal.ReadInt16(p,68)+(ushort)Marshal.ReadInt16(p,70);
  if(size<84)throw new Exception("프린터 DEVMODE 크기가 잘못되었습니다.");
  byte[] data=new byte[size];Marshal.Copy(p,data,0,size);return data;
 }
 byte[] ReadMode() {
  int needed;GetPrinter(handle,9,IntPtr.Zero,0,out needed);
  if(needed<IntPtr.Size)throw WinError("사용자별 프린터 설정 읽기");
  IntPtr buffer=Marshal.AllocHGlobal(needed);
  try { if(!GetPrinter(handle,9,buffer,needed,out needed))throw WinError("사용자별 프린터 설정 읽기");return CopyMode(Marshal.ReadIntPtr(buffer)); }
  finally { Marshal.FreeHGlobal(buffer); }
 }
 byte[] DefaultMode() {
  int size=DocumentProperties(IntPtr.Zero,handle,name,IntPtr.Zero,IntPtr.Zero,0);
  if(size<84)throw new Exception("프린터 드라이버 설정을 읽을 수 없습니다.");
  IntPtr p=Marshal.AllocHGlobal(size);
  try { if(DocumentProperties(IntPtr.Zero,handle,name,p,IntPtr.Zero,2)!=1)throw new Exception("프린터 드라이버 설정 읽기 실패");return CopyMode(p); }
  finally { Marshal.FreeHGlobal(p); }
 }
 public Paper[] Papers() {
  int count=DeviceCapabilities(name,null,2,IntPtr.Zero,IntPtr.Zero);
  if(count<1||count>10000)throw new Exception("프린터 지원 용지 목록을 읽을 수 없습니다.");
  IntPtr ids=Marshal.AllocHGlobal(count*2),names=Marshal.AllocHGlobal(count*128),sizes=Marshal.AllocHGlobal(count*8);
  try {
   if(DeviceCapabilities(name,null,2,ids,IntPtr.Zero)!=count||DeviceCapabilities(name,null,16,names,IntPtr.Zero)!=count||DeviceCapabilities(name,null,3,sizes,IntPtr.Zero)!=count)throw new Exception("프린터 지원 용지 목록이 변경됐습니다. 다시 시도하세요.");
   var result=new List<Paper>();
   for(int i=0;i<count;i++)result.Add(new Paper { Id=(ushort)Marshal.ReadInt16(ids,i*2),Name=Marshal.PtrToStringUni(IntPtr.Add(names,i*128),64).Split('\0')[0].TrimEnd(' '),Width=Marshal.ReadInt32(sizes,i*8),Height=Marshal.ReadInt32(sizes,i*8+4) });
   return result.ToArray();
  } finally { Marshal.FreeHGlobal(ids);Marshal.FreeHGlobal(names);Marshal.FreeHGlobal(sizes); }
 }
 void WriteMode(byte[] data) {
  IntPtr info=Marshal.AllocHGlobal(IntPtr.Size),mode=IntPtr.Zero;
  try {
   if(data!=null){mode=Marshal.AllocHGlobal(data.Length);Marshal.Copy(data,0,mode,data.Length);}
   Marshal.WriteIntPtr(info,mode);
   // Level 9 is per-user only; never use level 2 or 8 (shared defaults).
   if(!SetPrinter(handle,9,info,0))throw WinError("사용자별 프린터 설정 저장");
  } finally { if(mode!=IntPtr.Zero)Marshal.FreeHGlobal(mode);Marshal.FreeHGlobal(info); }
 }
 public void Apply(string paper,string orientation) {
  int w,h,standard;
  switch(paper){case "A4":w=2100;h=2970;standard=9;break;case "A3":w=2970;h=4200;standard=8;break;case "A2":w=4200;h=5940;standard=66;break;case "A1":w=5940;h=8410;standard=0;break;case "A0":w=8410;h=11890;standard=0;break;default:throw new Exception("지원하지 않는 용지입니다.");}
  if(orientation!="portrait"&&orientation!="landscape")throw new Exception("용지 방향이 잘못되었습니다.");
  Paper selected=null;
  foreach(Paper p in Papers()) {
   bool dimensions=(Math.Abs(p.Width-w)<=10&&Math.Abs(p.Height-h)<=10)||(Math.Abs(p.Width-h)<=10&&Math.Abs(p.Height-w)<=10);
   if(standard!=0 ? p.Id==standard&&dimensions : dimensions) {
    if(selected==null||p.Name.IndexOf(paper,StringComparison.OrdinalIgnoreCase)>=0)selected=p;
    if(standard!=0)break;
   }
  }
  if(selected==null)throw new Exception("선택한 프린터 드라이버는 "+paper+" 용지를 지원하지 않습니다.");
  byte[] data=original??DefaultMode();
  int capacity=Math.Max(data.Length,DocumentProperties(IntPtr.Zero,handle,name,IntPtr.Zero,IntPtr.Zero,0));
  IntPtr mode=Marshal.AllocHGlobal(capacity);
  try {
   Marshal.Copy(data,0,mode,data.Length);
   // DEVMODEW public offsets; preserve dmDriverExtra in its entirety.
   Marshal.WriteInt32(mode,72,(Marshal.ReadInt32(mode,72)|3)&~12);
   Marshal.WriteInt16(mode,76,(short)(orientation=="landscape"?2:1));
   Marshal.WriteInt16(mode,78,(short)selected.Id);
   if(DocumentProperties(IntPtr.Zero,handle,name,mode,mode,10)!=1)throw new Exception("프린터 드라이버가 요청 용지 설정을 거부했습니다.");
   if(Marshal.ReadInt16(mode,78)!=selected.Id||Marshal.ReadInt16(mode,76)!=(orientation=="landscape"?2:1))throw new Exception("프린터 드라이버가 요청한 용지 또는 방향을 적용하지 않았습니다.");
   changed=true;WriteMode(CopyMode(mode));
   byte[] actual=ReadMode();
   if(actual==null||BitConverter.ToInt16(actual,78)!=selected.Id||BitConverter.ToInt16(actual,76)!=(orientation=="landscape"?2:1))throw new Exception("사용자별 프린터 용지 설정을 확인할 수 없습니다.");
  } finally { Marshal.FreeHGlobal(mode); }
 }
 public void Restore() {
  if(!changed)return;
  WriteMode(original);
  byte[] actual=ReadMode();
  if((actual==null)!=(original==null))throw new Exception("프린터 원래 설정 복원을 확인할 수 없습니다.");
  if(actual!=null) {
   if(actual.Length!=original.Length)throw new Exception("프린터 원래 설정 크기가 다릅니다.");
   for(int i=0;i<actual.Length;i++)if(actual[i]!=original[i])throw new Exception("프린터 원래 설정이 완전히 복원되지 않았습니다.");
  }
  changed=false;
 }
 public void Dispose() { try { Restore(); } finally { if(handle!=IntPtr.Zero){ClosePrinter(handle);handle=IntPtr.Zero;}if(ownsGate){gate.ReleaseMutex();ownsGate=false;}if(gate!=null){gate.Dispose();gate=null;} } }
}
'@
$printer = $null
$parent = 0
$idleMs = 120000
function Reply($ok, $data, $message) {
 [Console]::WriteLine((@{id=$cmd.id;ok=$ok;data=$data;error=$message} | ConvertTo-Json -Depth 6 -Compress))
}
try {
 while ($true) {
  $cmd = $null
  $read = [BarunPrinter]::ReadCommand()
  $elapsed = 0
  while (-not $read.Wait(1000)) {
   $elapsed += 1000
   if ($elapsed -ge $idleMs -or ($parent -and -not (Get-Process -Id $parent -ErrorAction SilentlyContinue))) { throw '인쇄 도우미 대기 시간이 초과됐거나 앱이 종료됐습니다.' }
  }
  $line = $read.Result
  if ($null -eq $line) { break }
  try {
   $cmd = $line | ConvertFrom-Json
   switch ($cmd.action) {
    'open' { if ($printer) { throw '이미 열린 프린터 설정입니다.' }; $parent=[int]$cmd.parentPid; $idleMs=[int]$cmd.idleMs; $printer=New-Object BarunPrinter([string]$cmd.printerName); Reply $true $null $null }
    'set' { if (-not $printer) { throw '프린터 설정이 열리지 않았습니다.' }; $printer.Apply($cmd.paper,$cmd.orientation); Reply $true $null $null }
    'restore' { if ($printer) { $printer.Restore() }; Reply $true $null $null; break }
    default { throw '잘못된 프린터 설정 요청입니다.' }
   }
   if ($cmd.action -eq 'restore') { break }
  } catch { Reply $false $null $_.Exception.GetBaseException().Message }
 }
} finally {
 if ($printer) { $printer.Dispose() }
}
