#Requires -Version 5.1
<#
.SYNOPSIS
    Collects hardware info from this device and registers it in WSC Assets.

.DESCRIPTION
    Gathers system details (manufacturer, model, serial, OS, CPU, RAM, disk,
    MAC address, logged-in user, IP) via CIM/WMI and POSTs the asset to the
    WSC Assets API.  Automatically detects laptop vs desktop.

.PARAMETER ApiUrl
    The Worker URL, e.g. https://wsc-assets-api.illumanati80.workers.dev

.PARAMETER ApiKey
    The API key configured in the Worker secrets.

.PARAMETER LocationId
    (Optional) Location ID to assign the asset to.

.EXAMPLE
    .\Enroll-Asset.ps1 -ApiUrl "https://wsc-assets-api.illumanati80.workers.dev" -ApiKey "mykey123"
#>

param(
    [Parameter(Mandatory)]
    [string]$ApiUrl,

    [Parameter(Mandatory)]
    [string]$ApiKey,

    [string]$LocationId
)

$ErrorActionPreference = 'Stop'

# ── Gather hardware info ──────────────────────────────────────────

Write-Host "Collecting hardware information..." -ForegroundColor Cyan

$cs   = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
$os   = Get-CimInstance Win32_OperatingSystem
$cpu  = Get-CimInstance Win32_Processor | Select-Object -First 1
$disk = Get-CimInstance Win32_DiskDrive | Where-Object { $_.MediaType -like '*fixed*' } | Select-Object -First 1

# Detect laptop vs desktop
$chassis = (Get-CimInstance Win32_SystemEnclosure).ChassisTypes
# Chassis types: 9,10,14 = Laptop; 8,11 = Portable; 3,4,5,6,7 = Desktop/Tower
$laptopTypes = @(8, 9, 10, 11, 14, 30, 31, 32)
$isLaptop = ($chassis | Where-Object { $_ -in $laptopTypes }).Count -gt 0

# Category IDs matching seed.sql
$categoryId = if ($isLaptop) { 'cat_laptop' } else { 'cat_desktop' }
$deviceType = if ($isLaptop) { 'Laptop' } else { 'Desktop' }

# RAM in GB
$ramGB = [math]::Round($cs.TotalPhysicalMemory / 1GB)

# Disk size in GB
$diskGB = if ($disk) { [math]::Round($disk.Size / 1GB) } else { 0 }

# Primary network adapter (active, physical)
$adapter = Get-CimInstance Win32_NetworkAdapterConfiguration |
    Where-Object { $_.IPEnabled -and $_.MACAddress } |
    Select-Object -First 1

$mac = if ($adapter) { $adapter.MACAddress } else { 'N/A' }
$ip  = if ($adapter.IPAddress) { ($adapter.IPAddress | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' } | Select-Object -First 1) } else { 'N/A' }

$currentUser = $cs.UserName
$computerName = $cs.Name
$serial = $bios.SerialNumber

# ── Display summary ───────────────────────────────────────────────

Write-Host ""
Write-Host "═══════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "  Device Information" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "  Type:          $deviceType"
Write-Host "  Name:          $computerName"
Write-Host "  Manufacturer:  $($cs.Manufacturer)"
Write-Host "  Model:         $($cs.Model)"
Write-Host "  Serial:        $serial"
Write-Host "  OS:            $($os.Caption) $($os.Version)"
Write-Host "  CPU:           $($cpu.Name)"
Write-Host "  RAM:           ${ramGB} GB"
Write-Host "  Disk:          ${diskGB} GB"
Write-Host "  MAC:           $mac"
Write-Host "  IP:            $ip"
Write-Host "  User:          $currentUser"
Write-Host "═══════════════════════════════════════════" -ForegroundColor Yellow
Write-Host ""

# ── Build notes field with specs ──────────────────────────────────

$notes = @(
    "Auto-enrolled via PowerShell script"
    "OS: $($os.Caption) $($os.Version)"
    "CPU: $($cpu.Name)"
    "RAM: ${ramGB} GB"
    "Disk: ${diskGB} GB"
    "MAC: $mac"
    "IP: $ip"
    "User at enrollment: $currentUser"
    "Enrolled: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
) -join "`n"

# ── Check if asset already exists by serial number ────────────────

Write-Host "Checking if device is already registered..." -ForegroundColor Cyan

$headers = @{
    'X-Api-Key'    = $ApiKey
    'Content-Type' = 'application/json'
}

try {
    $check = Invoke-RestMethod -Uri "$ApiUrl/api/assets/serial/$serial" -Headers $headers -Method Get -ErrorAction Stop
    Write-Host ""
    Write-Host "This device is already registered as $($check.asset_tag) ($($check.name))" -ForegroundColor Yellow
    Write-Host "Skipping enrollment." -ForegroundColor Yellow
    exit 0
}
catch {
    # 404 = not found, which is what we want
    if ($_.Exception.Response.StatusCode.value__ -ne 404) {
        Write-Host "Warning: Could not check existing assets: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# ── Create the asset ──────────────────────────────────────────────

$assetName = if ($cs.Model -match "^$([regex]::Escape($cs.Manufacturer))") { $cs.Model } else { "$($cs.Manufacturer) $($cs.Model)" }
# Clean up common junk in manufacturer names
$assetName = $assetName -replace 'System manufacturer', '' -replace 'System Product Name', '' -replace '^\s+|\s+$', ''
if ([string]::IsNullOrWhiteSpace($assetName)) { $assetName = $computerName }

$body = @{
    name          = $assetName
    serial_number = $serial
    category_id   = $categoryId
    manufacturer  = $cs.Manufacturer -replace 'System manufacturer', 'Unknown'
    model         = $cs.Model -replace 'System Product Name', 'Unknown'
    status        = 'available'
    notes         = $notes
} | ConvertTo-Json

if ($LocationId) {
    $bodyObj = $body | ConvertFrom-Json
    $bodyObj | Add-Member -NotePropertyName 'location_id' -NotePropertyValue $LocationId
    $body = $bodyObj | ConvertTo-Json
}

Write-Host "Registering asset..." -ForegroundColor Cyan

try {
    $result = Invoke-RestMethod -Uri "$ApiUrl/api/assets" -Headers $headers -Method Post -Body $body -ErrorAction Stop
    Write-Host ""
    Write-Host "Successfully registered!" -ForegroundColor Green
    Write-Host "  Asset Tag: $($result.asset_tag)" -ForegroundColor Green
    Write-Host "  Asset ID:  $($result.id)" -ForegroundColor Green
    Write-Host ""
}
catch {
    Write-Host ""
    Write-Host "Failed to register asset: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "  Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
    exit 1
}
