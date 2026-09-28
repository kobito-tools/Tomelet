param([int]$Port)
if ($Port -lt 1024 -or $Port -gt 65535) { exit 1 }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Tomelet Timer'
$form.Size = New-Object System.Drawing.Size(320,200)
$form.TopMost = $true
$form.StartPosition = 'Manual'
$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.Location = New-Object System.Drawing.Point(($area.Left+18),($area.Bottom-170))
$value = New-Object System.Windows.Forms.Label
$value.Location = New-Object System.Drawing.Point(16,12)
$value.Size = New-Object System.Drawing.Size(260,48)
$value.Font = New-Object System.Drawing.Font('Consolas',30,[System.Drawing.FontStyle]::Bold)
$detail = New-Object System.Windows.Forms.Label
$detail.Location = New-Object System.Drawing.Point(18,68)
$detail.Size = New-Object System.Drawing.Size(252,28)
$detail.AutoEllipsis = $true
$form.Controls.Add($value)
$form.Controls.Add($detail)
$complete = New-Object System.Windows.Forms.Button
$complete.Text = '完了'
$complete.Location = New-Object System.Drawing.Point(18,105)
$complete.Size = New-Object System.Drawing.Size(125,32)
$complete.Add_Click({ Start-Process "http://127.0.0.1:$Port/?timerComplete=1" })
$off = New-Object System.Windows.Forms.Button
$off.Text = '常駐OFF'
$off.Location = New-Object System.Drawing.Point(155,105)
$off.Size = New-Object System.Drawing.Size(125,32)
$off.Add_Click({ $form.Close() })
$form.Controls.Add($complete)
$form.Controls.Add($off)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick({
 try {
  $data = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/timer" -TimeoutSec 2
  $complete.Enabled = [bool]$data.active
  $item = $data.active
  $target = if ($data.active -and $item.targetEndTime) { $item.targetEndTime } else { $item.endTime }
  $prefix = 'Active | '
  if (-not $item) { $item=$data.upcoming; $target=$item.startTime; $prefix='Next | ' }
  if ($item) {
   $left = [datetime]::Today.Add([timespan]::Parse($target)) - [datetime]::Now
   if ($left.TotalSeconds -lt 0) { $left=[timespan]::Zero }
   $value.Text = $left.ToString('hh\:mm\:ss')
   $detail.Text = $prefix + $item.action
  } else { $value.Text=$data.localTime; $detail.Text='LOCAL TIME' }
 } catch { $detail.Text='Tomelet connection unavailable' }
})
$timer.Start()
[System.Windows.Forms.Application]::Run($form)
$timer.Dispose()
