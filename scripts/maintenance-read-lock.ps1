# Holds read-only native file handles that deny writers and replacement during maintenance.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$handles = @()
try {
    $paths = [Console]::ReadLine() | ConvertFrom-Json
    foreach ($file in $paths) {
        $handles += [System.IO.File]::Open($file, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    }
    [Console]::WriteLine('{"ready":true}')
    [Console]::Out.Flush()
    $null = [Console]::ReadLine()
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    foreach ($handle in $handles) { $handle.Dispose() }
}
