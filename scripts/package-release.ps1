$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$extension = Join-Path $workspace 'extension'
$manifest = Get-Content (Join-Path $extension 'manifest.json') -Raw | ConvertFrom-Json
$package = Get-Content (Join-Path $workspace 'package.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne $package.version) { throw 'Manifest/package version mismatch' }
$output = Join-Path $workspace 'releases'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$archive = Join-Path $output "rejs-$($manifest.version).zip"
$sources = @((Join-Path $extension '*'), (Join-Path $workspace 'README.md'), (Join-Path $workspace 'CHANGELOG.md'), (Join-Path $workspace 'LICENSE'))
Compress-Archive -Path $sources -DestinationPath $archive -Force
$sha = [System.Security.Cryptography.SHA256]::Create()
try { $hash = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($archive))).Replace('-', '').ToLowerInvariant() }
finally { $sha.Dispose() }
"$hash  $(Split-Path $archive -Leaf)" | Set-Content -LiteralPath "$archive.sha256" -Encoding ascii
Write-Output $archive
Write-Output "SHA256 $hash"
