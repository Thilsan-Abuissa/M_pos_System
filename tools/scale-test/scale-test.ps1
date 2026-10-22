# Scale diagnostic: reads raw data from every COM port at common speeds and saves
# the result to the Desktop, so the scale's real output format can be checked.
# Close the POS first (it holds the COM port), put an item on the scale, then run.

$ErrorActionPreference = 'Continue'
$out = New-Object System.Collections.Generic.List[string]
function Log($text) { Write-Host $text; $out.Add($text) }

function Show-Bytes([byte[]]$bytes) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($b in $bytes) {
    if ($b -lt 32 -or $b -gt 126) { [void]$sb.Append(('<{0:x2}>' -f $b)) }
    else { [void]$sb.Append([char]$b) }
  }
  return $sb.ToString()
}

function Read-For($port, [int]$ms) {
  $buf = New-Object System.Collections.Generic.List[byte]
  $end = (Get-Date).AddMilliseconds($ms)
  while ((Get-Date) -lt $end) {
    $n = $port.BytesToRead
    if ($n -gt 0) {
      $chunk = New-Object byte[] $n
      [void]$port.Read($chunk, 0, $n)
      $buf.AddRange($chunk)
    }
    Start-Sleep -Milliseconds 50
  }
  return ,$buf.ToArray()
}

Log "=== SCALE TEST  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="
Log ""
Log "COM ports on this PC:"
Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\(COM\d+\)' } | ForEach-Object { Log ("  " + $_.Name + "  [" + $_.Status + "]") }
Log ""

$polls = @(
  @{ name = 'EOT ENQ (Dialog)'; bytes = [byte[]](0x04, 0x05) },
  @{ name = 'ENQ';              bytes = [byte[]](0x05) },
  @{ name = 'P CR LF';          bytes = [byte[]](0x50, 0x0D, 0x0A) },
  @{ name = 'W CR LF';          bytes = [byte[]](0x57, 0x0D, 0x0A) },
  @{ name = '$';                bytes = [byte[]](0x24) }
)

foreach ($portName in [System.IO.Ports.SerialPort]::GetPortNames()) {
  $busy = $false
  foreach ($baud in 9600, 4800, 2400, 19200) {
    if ($busy) { break }
    foreach ($fmt in @(@{ bits = 8; parity = 'None' }, @{ bits = 7; parity = 'Even' })) {
      if ($fmt.bits -eq 7 -and $baud -ne 9600) { continue }
      $label = "$portName  $baud  $($fmt.bits)$($fmt.parity.Substring(0,1))1"
      $port = New-Object System.IO.Ports.SerialPort $portName, $baud, $fmt.parity, $fmt.bits, 'One'
      $port.DtrEnable = $true
      $port.RtsEnable = $true
      $port.ReadTimeout = 500
      try {
        $port.Open()
      } catch {
        Log "$label : CANNOT OPEN - $($_.Exception.Message)"
        Log "    (If it says access denied: close the POS / other programs using this port.)"
        $busy = $true
        break
      }
      try {
        Start-Sleep -Milliseconds 200
        $data = Read-For $port 2500
        if ($data.Length -gt 0) {
          Log "$label : SENDS BY ITSELF ($($data.Length) bytes)"
          Log ("    " + (Show-Bytes ($data | Select-Object -Last 160)))
        } else {
          $answered = $false
          foreach ($p in $polls) {
            $port.DiscardInBuffer()
            $port.Write($p.bytes, 0, $p.bytes.Length)
            $data = Read-For $port 700
            if ($data.Length -gt 0) {
              Log "$label : ANSWERS to $($p.name) ($($data.Length) bytes)"
              Log ("    " + (Show-Bytes ($data | Select-Object -Last 160)))
              $answered = $true
            }
          }
          if (-not $answered) { Log "$label : silent" }
        }
      } finally {
        $port.Close()
      }
    }
  }
  Log ""
}

$file = Join-Path ([Environment]::GetFolderPath('Desktop')) 'scale-test-result.txt'
$out | Set-Content -Path $file -Encoding UTF8
Log "Saved to: $file"
Log "Send a photo of this window or the file scale-test-result.txt."
