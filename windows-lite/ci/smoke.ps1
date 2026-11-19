param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class WinSmoke {
    [DllImport("user32", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32", CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32")] public static extern bool IsWindowEnabled(IntPtr w);
    [DllImport("user32")] public static extern bool IsWindowVisible(IntPtr w);
    [DllImport("user32", CharSet=CharSet.Unicode, EntryPoint="SendMessageTimeoutW")] static extern IntPtr Msg(IntPtr w, uint m, IntPtr wp, IntPtr lp, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32", CharSet=CharSet.Unicode, EntryPoint="SendMessageTimeoutW")] static extern IntPtr Get(IntPtr w, uint m, IntPtr wp, StringBuilder text, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32", CharSet=CharSet.Unicode, EntryPoint="SendMessageTimeoutW")] static extern IntPtr Set(IntPtr w, uint m, IntPtr wp, string text, uint flags, uint timeout, out IntPtr result);
    public static List<IntPtr> Children(IntPtr parent, string cls) {
        var list = new List<IntPtr>(); IntPtr w = IntPtr.Zero;
        while ((w = FindWindowEx(parent,w,cls,null)) != IntPtr.Zero) list.Add(w);
        return list;
    }
    public static IntPtr Number(IntPtr w, uint msg) {
        IntPtr result; Msg(w,msg,IntPtr.Zero,IntPtr.Zero,2,1500,out result); return result;
    }
    public static void Text(IntPtr w, string text) {
        IntPtr r; if (Set(w,12,IntPtr.Zero,text,2,1500,out r)==IntPtr.Zero) throw new Exception("WM_SETTEXT timed out");
    }
    public static string Read(IntPtr w) {
        var buf=new StringBuilder(8192); IntPtr r; Get(w,13,(IntPtr)buf.Capacity,buf,2,1500,out r); return buf.ToString();
    }
}
'@
function Wait-For($Condition, $Description) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        if ($proc -and $proc.HasExited) {throw "Client exited: $($proc.ExitCode) while waiting for $Description"}
        $result = & $Condition
        if ($result) { return $result }
        Start-Sleep -Milliseconds 150
    } until ($watch.Elapsed.TotalSeconds -gt 25)
    foreach ($title in @('Шифр-связь — Вход','Шифр-связь — qa_user')) {
        $w=[WinSmoke]::FindWindow($null,$title)
        if ($w -ne [IntPtr]::Zero) {
            foreach ($label in [WinSmoke]::Children($w,'Static')) {Write-Host ([WinSmoke]::Read($label))}
        }
    }
    throw "Timeout: $Description"
}
function Click-Button($Parent, $Label) {
    $b = Wait-For {
        foreach ($child in [WinSmoke]::Children($Parent,'Button')) {
            if ([WinSmoke]::IsWindowEnabled($child) -and [WinSmoke]::Read($child) -eq $Label) {return $child}
        }
    } "button $Label"
    $null = [WinSmoke]::Number($b,0xF5)
}
function Visible-Window($Title) {
    $w=[WinSmoke]::FindWindow($null,$Title)
    if ($w -ne [IntPtr]::Zero -and [WinSmoke]::IsWindowVisible($w)) {return $w}
}
$fixture = Start-Process python -ArgumentList 'ci/fixture.py' -PassThru -NoNewWindow
$proc = $null
try {
    $portPath = Join-Path $env:RUNNER_TEMP 'shifr-test-port'
    $port = Wait-For { if (Test-Path $portPath) { Get-Content $portPath } } 'loopback TLS fixture'
    # Isolate preferences from the runner profile. No certificate is installed globally.
    $env:LOCALAPPDATA = Join-Path $env:RUNNER_TEMP 'shifr-client-profile'
    $pref = Join-Path $env:LOCALAPPDATA 'ShifrSvyazLite'
    New-Item -Force -ItemType Directory $pref | Out-Null
    @{address="127.0.0.1:$port";nickname='qa_user';ca_file=(Join-Path $env:RUNNER_TEMP 'shifr-test-ca.crt')} |
        ConvertTo-Json | Set-Content -Encoding utf8NoBOM (Join-Path $pref 'connection.json')
    $proc = Start-Process $Executable -PassThru
    $login = Wait-For { Visible-Window 'Шифр-связь — Вход' } 'login window'
    $password = Wait-For {
        foreach ($edit in [WinSmoke]::Children($login,'Edit')) {
            if ([WinSmoke]::Number($edit,0xD2) -ne [IntPtr]::Zero) {return $edit}
        }
    } 'native password field'
    [WinSmoke]::Text($password,'fixture-password')
    Click-Button $login 'Войти'
    $chat = Wait-For { Visible-Window 'Шифр-связь — qa_user' } 'authenticated chat window'
    function Find-Text($text) {
        foreach ($edit in [WinSmoke]::Children($chat,'Edit')) {
            if ([WinSmoke]::Read($edit).Contains($text)) {return $edit}
        }
    }
    $null = Wait-For { Find-Text 'Test history' } 'authenticated HTTPS history'
    $compose = Wait-For {
        foreach ($edit in [WinSmoke]::Children($chat,'Edit')) {
            # The composer enforces the server's 350-byte text limit again before sending.
            if ([WinSmoke]::Number($edit,0xD5).ToInt64() -eq 350 -and [WinSmoke]::IsWindowEnabled($edit)) {return $edit}
        }
    } 'composer enabled after WSS join'
    [WinSmoke]::Text($compose,'Rust smoke echo')
    Click-Button $chat 'Отправить'
    $null = Wait-For { Find-Text 'Rust smoke echo' } 'WSS server echo'
    $null = Wait-For { [WinSmoke]::Read($compose) -eq '' } 'draft cleared after confirmation'
    $proc.Refresh()
    Write-Host ("CHAT_WORKING_SET_BYTES=" + $proc.WorkingSet64)
    Write-Host ("CHAT_PRIVATE_BYTES=" + $proc.PrivateMemorySize64)
    Click-Button $chat 'Выйти'
    $null = Wait-For { Visible-Window 'Шифр-связь — Вход' } 'logout'
    Write-Host 'PASS: UI login, local CA, cookie, Origin, HTTPS history, WSS join, send and confirmation, logout'
} finally {
    if ($proc -and !$proc.HasExited) { Stop-Process -Id $proc.Id }
    if (!$fixture.HasExited) { Stop-Process -Id $fixture.Id }
}
