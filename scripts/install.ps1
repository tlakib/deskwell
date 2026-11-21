# DeskWell installer for Windows (PowerShell).
#   irm https://raw.githubusercontent.com/tlakib/deskwell/main/scripts/install.ps1 | iex
# Optional: also download the Chrome extension to Documents\DeskWell\chrome-extension
#   $env:DESKWELL_CHROME = "1"; irm https://raw.githubusercontent.com/tlakib/deskwell/main/scripts/install.ps1 | iex
# Made by Md Ashik Ali - https://www.linkedin.com/in/mdashikali/ - MIT license.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$repo = "tlakib/deskwell"

Write-Host "DeskWell installer" -ForegroundColor Magenta
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ "User-Agent" = "deskwell-installer" }
$asset = $release.assets | Where-Object { $_.name -like "*x64-setup.exe" } | Select-Object -First 1
if (-not $asset) { throw "No Windows installer found in release $($release.tag_name)." }

$tmp = Join-Path $env:TEMP $asset.name
Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) MB)..."
Invoke-WebRequest $asset.browser_download_url -OutFile $tmp
Unblock-File $tmp

Write-Host "Installing (current user, no admin needed)..."
Start-Process -FilePath $tmp -ArgumentList "/S" -Wait
Remove-Item $tmp -ErrorAction SilentlyContinue

$exe = Join-Path $env:LOCALAPPDATA "DeskWell\deskwell.exe"
if (-not (Test-Path $exe)) { $exe = Get-ChildItem "$env:LOCALAPPDATA\DeskWell" -Filter *.exe -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike "uninstall*" } | Select-Object -First 1 -ExpandProperty FullName }
if ($exe) { Start-Process $exe; Write-Host "DeskWell $($release.tag_name) installed and started. Look for the icon in the system tray." -ForegroundColor Green }
else { Write-Host "Installed. Start DeskWell from the Start menu." -ForegroundColor Green }

if ($env:DESKWELL_CHROME -eq "1") {
  $zip = $release.assets | Where-Object { $_.name -like "deskwell-extension-*.zip" } | Select-Object -First 1
  if ($zip) {
    $dest = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "DeskWell\chrome-extension"
    $zipPath = Join-Path $env:TEMP $zip.name
    Invoke-WebRequest $zip.browser_download_url -OutFile $zipPath
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Expand-Archive $zipPath -DestinationPath $dest
    Remove-Item $zipPath
    Write-Host "Chrome extension saved to $dest"
    Write-Host "In Chrome: open chrome://extensions, turn on Developer mode, click 'Load unpacked' and pick that folder."
  }
}
