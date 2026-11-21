# DeskWell installer for Windows (PowerShell).
#   irm https://raw.githubusercontent.com/tlakib/deskwell/main/scripts/install.ps1 | iex
# Optional: also download the Chrome extension to Documents\DeskWell\chrome-extension
#   $env:DESKWELL_CHROME = "1"; irm https://raw.githubusercontent.com/tlakib/deskwell/main/scripts/install.ps1 | iex
# Made by Md Ashik Ali - https://www.linkedin.com/in/mdashikali/ - MIT license.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$repo = "tlakib/deskwell"

Write-Host "DeskWell installer" -ForegroundColor Magenta

# Microsoft Store ID, set once DeskWell is published in the Store. The Store build is signed by Microsoft,
# so it installs even with Smart App Control on.
$storeId = "9PBZJ6MR67FB"  # DeskWell on the Microsoft Store
if ($storeId -and (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Host "Installing DeskWell from the Microsoft Store..."
  winget install --id $storeId --source msstore --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -eq 0) { Write-Host "DeskWell installed. Start it from the Start menu." -ForegroundColor Green; return }
  Write-Host "Store install did not finish; trying the GitHub installer instead."
}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

# Find the latest version from the Releases page redirect (no GitHub API, so no API rate limit).
function Get-LatestTag {
  $req = [System.Net.WebRequest]::Create("https://github.com/$repo/releases/latest")
  $req.AllowAutoRedirect = $false
  $req.Method = "HEAD"
  $req.UserAgent = "deskwell-installer"
  try { $resp = $req.GetResponse() } catch [System.Net.WebException] { $resp = $_.Exception.Response }
  if (-not $resp) { throw "Could not reach github.com. Check your internet connection." }
  $location = $resp.Headers["Location"]
  $resp.Close()
  if ($location -notmatch "/releases/tag/([^/?#]+)") { throw "Could not find the latest DeskWell release. Download it from https://github.com/$repo/releases/latest" }
  return $Matches[1]
}

$tag = Get-LatestTag
$version = $tag.TrimStart("v")
$base = "https://github.com/$repo/releases/download/$tag"
$setupName = "DeskWell_${version}_x64-setup.exe"

$tmp = Join-Path $env:TEMP $setupName
Write-Host "Downloading DeskWell $version for Windows..."
Invoke-WebRequest "$base/$setupName" -OutFile $tmp -UseBasicParsing
Unblock-File $tmp

Write-Host "Installing (current user, no admin needed)..."
try {
  Start-Process -FilePath $tmp -ArgumentList "/S" -Wait
} catch {
  Remove-Item $tmp -ErrorAction SilentlyContinue
  if ("$_" -match "Application Control|blocked") {
    Write-Host ""
    Write-Host "Windows blocked the DeskWell installer." -ForegroundColor Yellow
    Write-Host "Smart App Control (or a company app policy) is on, and it only allows code-signed apps."
    Write-Host "DeskWell's installer is not code-signed yet, so it can't be installed on this PC for now."
    Write-Host "Options:"
    Write-Host "  - Use the DeskWell Chrome extension instead (works with Smart App Control on)."
    Write-Host "  - Install on a PC where Smart App Control is off."
    Write-Host "  - Watch https://github.com/$repo/releases for a signed build."
    Write-Host "DeskWell will not ask you to turn security features off."
    return
  }
  throw
}
Remove-Item $tmp -ErrorAction SilentlyContinue

$exe = Join-Path $env:LOCALAPPDATA "DeskWell\deskwell.exe"
if (-not (Test-Path $exe)) { $exe = Get-ChildItem "$env:LOCALAPPDATA\DeskWell" -Filter *.exe -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike "uninstall*" } | Select-Object -First 1 -ExpandProperty FullName }
if ($exe) { Start-Process $exe; Write-Host "DeskWell $version installed and started. Look for the icon in the system tray." -ForegroundColor Green }
else { Write-Host "Installed. Start DeskWell from the Start menu." -ForegroundColor Green }

if ($env:DESKWELL_CHROME -eq "1") {
  $zipName = "deskwell-extension-$version.zip"
  $dest = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "DeskWell\chrome-extension"
  $zipPath = Join-Path $env:TEMP $zipName
  Invoke-WebRequest "$base/$zipName" -OutFile $zipPath -UseBasicParsing
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  Expand-Archive $zipPath -DestinationPath $dest
  Remove-Item $zipPath
  Write-Host "Chrome extension saved to $dest"
  Write-Host "In Chrome: open chrome://extensions, turn on Developer mode, click 'Load unpacked' and pick that folder."
}
