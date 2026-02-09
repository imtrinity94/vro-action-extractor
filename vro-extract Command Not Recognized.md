# Fix: `vro-extract` Command Not Recognized After npm Global Install (PowerShell)

## Issue
After running `npm install -g vro-action-extractor`, the `vro-extract` command fails in PowerShell:

**Root Cause**: npm global bin directory (`C:\Users\<username>\AppData\Roaming\npm`) not in PowerShell's PATH.

## Environment
- **OS**: Windows (PowerShell)
- **Tool**: `vro-action-extractor` (vRO package action extractor)
- **Node.js**: Installed via standard installer
- **npm**: Global install location not in PATH

## Quick Fix (Temporary)
Run in current PowerShell session:

```powershell
# Find npm global prefix
$npmPrefix = npm config get prefix

# Add to PATH temporarily
$env:PATH += ";$npmPrefix"

# Verify and test
npm list -g --depth=0
vro-extract .\complete.Package.package
```
## Permanent Fix (User PATH)
Run as Administrator (affects current user):

```powershell
# Get npm prefix and add permanently
$npmPrefix = npm config get prefix
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
$newPath = "$currentPath;$npmPrefix"
[Environment]::SetEnvironmentVariable("Path", $newPath, "User")

Write-Host "Restart PowerShell and test: vro-extract --help"
```
Verification Steps
```powershell
# Check global packages
npm list -g --depth=0

# Check PATH contains npm bin
npm config get prefix

# Test extractor
vro-extract --help
vro``-extract .\complete.Package.package
```
