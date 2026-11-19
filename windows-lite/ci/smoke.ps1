param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
function Wait-For($Condition, $Description) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        try { $result = & $Condition; if ($result) { return $result } } catch {}
        Start-Sleep -Milliseconds 150
    } until ($watch.Elapsed.TotalSeconds -gt 25)
    throw "Timeout: $Description"
}
function Find-UI($Parent, $Property, $Value, $Scope) {
    $condition = [System.Windows.Automation.PropertyCondition]::new($Property, $Value)
    return $Parent.FindFirst($Scope, $condition)
}
function Click-Button($Parent, $Label) {
    $button = Wait-For {
        $b = Find-UI $Parent ([System.Windows.Automation.AutomationElement]::NameProperty) $Label 'Descendants'
        if ($b -and $b.Current.IsEnabled) { $b }
    } "button $Label"
    $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
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
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $prop = [System.Windows.Automation.AutomationElement]::NameProperty
    $login = Wait-For { Find-UI $root $prop 'Шифр-связь — Вход' 'Children' } 'login window'
    $password = Wait-For { Find-UI $login ([System.Windows.Automation.AutomationElement]::IsPasswordProperty) $true 'Descendants' } 'password field'
    $password.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue('fixture-password')
    Click-Button $login 'Войти'
    $chat = Wait-For { Find-UI $root $prop 'Шифр-связь — qa_user' 'Children' } 'authenticated chat window'
    $editCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)
    function Find-Text($text) {
        foreach ($edit in $chat.FindAll('Descendants',$editCondition)) {
            $p = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($p.Current.Value.Contains($text)) {return $edit}
        }
    }
    $null = Wait-For { Find-Text 'Test history' } 'authenticated HTTPS history'
    # Select the enabled, single-line editor right of the conversation list.
    $compose = Wait-For {
        $edits = $chat.FindAll('Descendants',$editCondition)
        foreach ($edit in $edits) {
            $p = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($edit.Current.IsEnabled -and !$p.Current.IsReadOnly -and $edit.Current.BoundingRectangle.Width -gt 260) {return $edit}
        }
    } 'composer enabled after WSS join'
    $compose.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue('Rust smoke echo')
    Click-Button $chat 'Отправить'
    $null = Wait-For { Find-Text 'Rust smoke echo' } 'WSS server echo'
    $null = Wait-For { $compose.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value -eq '' } 'draft cleared after confirmation'
    $proc.Refresh()
    Write-Host ("CHAT_WORKING_SET_BYTES=" + $proc.WorkingSet64)
    Write-Host ("CHAT_PRIVATE_BYTES=" + $proc.PrivateMemorySize64)
    Click-Button $chat 'Выйти'
    $null = Wait-For { Find-UI $root $prop 'Шифр-связь — Вход' 'Children' } 'logout'
    Write-Host 'PASS: UI login, local CA, cookie, Origin, HTTPS history, WSS join, send and confirmation, logout'
} finally {
    if ($proc -and !$proc.HasExited) { Stop-Process -Id $proc.Id }
    if (!$fixture.HasExited) { Stop-Process -Id $fixture.Id }
}
