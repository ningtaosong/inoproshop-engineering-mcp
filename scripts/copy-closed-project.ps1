param([Parameter(Mandatory=$true)][string]$SourcePath,[Parameter(Mandatory=$true)][string]$DestinationPath)
$ErrorActionPreference = 'Stop'
# FileShare.None 在复制整个过程中持有排他源句柄；不保存或接管任何 IDE。
$sourceFile = [IO.File]::Open($SourcePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
try {
    $destinationFile = [IO.File]::Open($DestinationPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $sourceFile.CopyTo($destinationFile); $destinationFile.Flush($true) }
    finally { $destinationFile.Dispose() }
} finally { $sourceFile.Dispose() }
