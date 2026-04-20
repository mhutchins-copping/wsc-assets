# WSC Assets -- Device Enrolment Script
#
# Collects hardware specs from the local Windows machine and registers it
# in the asset register, or updates the existing record if one already
# exists for the same BIOS serial number. Safe to re-run -- idempotent by
# serial. Auto-detects laptop vs desktop from chassis type.
#
# Requirements: Windows PowerShell 5.1+ or PowerShell 7+. No elevation
# needed on most machines (a few WMI queries on locked-down endpoints may
# need admin -- those fields fall back to null if blocked).
#
# Usage:
#   1. Obtain the WSC Assets API key from IT.
#   2. Run:
#        $env:WSC_API_KEY = '<your-api-key>'
#        .\enrol-device.ps1
#      Or inline:
#        .\enrol-device.ps1 -ApiKey '<key>'
#
# To deploy via GPO / login script: set WSC_API_KEY as a machine-wide
# environment variable (or pass -ApiKey) and schedule this script to run
# once per logon. Re-runs on already-enrolled machines just refresh the
# specs -- no dupes.

[CmdletBinding()]
param(
  [string]$ApiKey = $env:WSC_API_KEY,
  [string]$ApiUrl = 'https://api.it-wsc.com',
  [string]$Category = '',            # Override auto-detected category id (e.g. cat_desktop)
  [switch]$WhatIf                    # Show what would be sent without posting
)

$ErrorActionPreference = 'Stop'

if (-not $ApiKey -and -not $WhatIf) {
  Write-Error "API key required. Set `$env:WSC_API_KEY or pass -ApiKey. Use -WhatIf to preview without posting."
  exit 1
}

Write-Host "Collecting device info..." -ForegroundColor Cyan

try {
  $cs   = Get-CimInstance Win32_ComputerSystem
  $bios = Get-CimInstance Win32_BIOS
  $os   = Get-CimInstance Win32_OperatingSystem
  $cpu  = Get-CimInstance Win32_Processor | Select-Object -First 1
} catch {
  Write-Error "Failed to read system info: $_"
  exit 1
}

$enclosure = Get-CimInstance Win32_SystemEnclosure -ErrorAction SilentlyContinue

# Total fixed-disk capacity (sum of local drives). Rounded to whole GB.
$totalDiskGb = $null
try {
  $disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3"
  if ($disks) {
    $totalDiskGb = [math]::Round(($disks | Measure-Object -Property Size -Sum).Sum / 1GB)
  }
} catch { }

# Primary IPv4 + MAC from whichever interface has the default gateway.
$ipAddress = $null
$macAddress = $null
try {
  $ipConfig = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null } | Select-Object -First 1
  if ($ipConfig) {
    $ipAddress = $ipConfig.IPv4Address.IPAddress
    $adapter = Get-NetAdapter -InterfaceIndex $ipConfig.InterfaceIndex -ErrorAction SilentlyContinue
    if ($adapter) { $macAddress = $adapter.MacAddress }
  }
} catch { }

# Chassis type -> category mapping (Win32_SystemEnclosure.ChassisTypes).
# Codes from the DMTF spec. Unmapped chassis fall through to the default.
$categoryMap = @{
  3  = 'cat_desktop'; 4  = 'cat_desktop'; 5  = 'cat_desktop'
  6  = 'cat_desktop'; 7  = 'cat_desktop'; 15 = 'cat_desktop'; 16 = 'cat_desktop'
  8  = 'cat_laptop';  9  = 'cat_laptop';  10 = 'cat_laptop'
  14 = 'cat_laptop';  31 = 'cat_laptop'
  11 = 'cat_tablet';  30 = 'cat_tablet';  32 = 'cat_tablet'
  17 = 'cat_server';  23 = 'cat_server'
}
$detectedCategory = 'cat_laptop'
if ($enclosure) {
  $chassisType = $enclosure.ChassisTypes | Select-Object -First 1
  if ($chassisType -and $categoryMap.ContainsKey([int]$chassisType)) {
    $detectedCategory = $categoryMap[[int]$chassisType]
  }
}
if (-not $Category) { $Category = $detectedCategory }

$payload = [ordered]@{
  serial_number = $bios.SerialNumber
  hostname      = $cs.Name
  manufacturer  = $cs.Manufacturer
  model         = $cs.Model
  os            = "$($os.Caption) $($os.Version)"
  cpu           = $cpu.Name.Trim()
  ram_gb        = [math]::Round($cs.TotalPhysicalMemory / 1GB)
  disk_gb       = $totalDiskGb
  mac_address   = $macAddress
  ip_address    = $ipAddress
  enrolled_user = $env:USERNAME
  category_id   = $Category
}

Write-Host ""
Write-Host "  Hostname:   $($payload.hostname)"
Write-Host "  Make/Model: $($payload.manufacturer) $($payload.model)"
Write-Host "  Serial:     $($payload.serial_number)"
Write-Host "  OS:         $($payload.os)"
Write-Host "  CPU:        $($payload.cpu)"
Write-Host "  RAM:        $($payload.ram_gb) GB"
Write-Host "  Disk:       $($payload.disk_gb) GB"
Write-Host "  Network:    $($payload.ip_address) / $($payload.mac_address)"
Write-Host "  User:       $($payload.enrolled_user)"
Write-Host "  Category:   $($payload.category_id)"
Write-Host ""

if ($WhatIf) {
  Write-Host "WhatIf -- not posting to API." -ForegroundColor Yellow
  $payload | ConvertTo-Json
  exit 0
}

Write-Host "Enrolling against $ApiUrl ..." -ForegroundColor Cyan

try {
  $body = $payload | ConvertTo-Json -Depth 3
  $response = Invoke-RestMethod `
    -Uri "$ApiUrl/api/assets/enrol" `
    -Method Post `
    -Headers @{ 'X-Api-Key' = $ApiKey; 'Content-Type' = 'application/json' } `
    -Body $body
} catch {
  Write-Error "Enrolment failed: $($_.Exception.Message)"
  if ($_.Exception.Response) {
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      $reader = New-Object System.IO.StreamReader($stream)
      $errBody = $reader.ReadToEnd()
      if ($errBody) { Write-Host $errBody -ForegroundColor Red }
    } catch { }
  }
  exit 1
}

$status = if ($response.created) { 'Created' } else { 'Updated' }
$color  = if ($response.created) { 'Green' }   else { 'Yellow' }
Write-Host ""
Write-Host "$status asset $($response.asset_tag)" -ForegroundColor $color
Write-Host "View: https://assets.it-wsc.com/#/a/$($response.asset_tag)"
