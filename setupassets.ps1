# setup-assets.ps1
# ---------------------------------------------------------------------------
# StockShot — fetches the on-device background-removal assets into public/.
#
# Run this from the root of your StockShot repo (the folder with package.json):
#
#     powershell -ExecutionPolicy Bypass -File .\setup-assets.ps1
#
# It is safe to run more than once.
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # Invoke-WebRequest is very slow with the progress bar on

Write-Host ""
Write-Host "StockShot asset setup" -ForegroundColor Cyan
Write-Host "=====================" -ForegroundColor Cyan
Write-Host ""

# --- 0. sanity check: are we in the right folder? --------------------------
if (-not (Test-Path 'package.json')) {
    Write-Host "ERROR: no package.json here." -ForegroundColor Red
    Write-Host "  Run this from your StockShot repo root — the folder that contains"
    Write-Host "  package.json, index.html and the src folder."
    Write-Host "  You are currently in: $(Get-Location)"
    exit 1
}

# --- 1. npm packages -------------------------------------------------------
Write-Host "[1/4] Installing npm packages..." -ForegroundColor Yellow
npm install onnxruntime-web jsbarcode
if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed." -ForegroundColor Red; exit 1 }
npm install --save-dev '@types/jsbarcode'
if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed." -ForegroundColor Red; exit 1 }
Write-Host "      done." -ForegroundColor Green

# --- 2. folders ------------------------------------------------------------
Write-Host "[2/4] Creating public\models and public\ort..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path 'public\models' | Out-Null
New-Item -ItemType Directory -Force -Path 'public\ort'    | Out-Null
Write-Host "      done." -ForegroundColor Green

# --- 3. the model ----------------------------------------------------------
$modelPath = 'public\models\u2netp.onnx'
$modelUrl  = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx'

Write-Host "[3/4] Downloading u2netp.onnx (4.7 MB)..." -ForegroundColor Yellow
if ((Test-Path $modelPath) -and ((Get-Item $modelPath).Length -gt 4MB)) {
    Write-Host "      already present, skipping." -ForegroundColor Green
} else {
    Invoke-WebRequest -Uri $modelUrl -OutFile $modelPath

    # A failed download from GitHub usually still writes a file — an HTML error
    # page a few KB long. Check the size so that fails loudly here rather than
    # silently at runtime in the browser.
    $size = (Get-Item $modelPath).Length
    if ($size -lt 4MB) {
        Write-Host "ERROR: the download looks wrong — got $([math]::Round($size/1KB)) KB, expected about 4700 KB." -ForegroundColor Red
        Write-Host "  Open this URL in a browser and save it to $modelPath manually:"
        Write-Host "  $modelUrl"
        exit 1
    }
    Write-Host "      done — $([math]::Round($size/1MB, 1)) MB." -ForegroundColor Green
}

# --- 4. the WebAssembly runtime -------------------------------------------
Write-Host "[4/4] Copying onnxruntime .wasm files..." -ForegroundColor Yellow
$dist = 'node_modules\onnxruntime-web\dist'
if (-not (Test-Path $dist)) {
    Write-Host "ERROR: $dist not found — the npm install in step 1 did not complete." -ForegroundColor Red
    exit 1
}

Copy-Item "$dist\*.wasm" 'public\ort\' -Force
$mjs = Get-ChildItem "$dist\*.mjs" -ErrorAction SilentlyContinue
if ($mjs) { Copy-Item "$dist\*.mjs" 'public\ort\' -Force }

$wasmCount = (Get-ChildItem 'public\ort\*.wasm').Count
if ($wasmCount -eq 0) {
    Write-Host "ERROR: no .wasm files were copied." -ForegroundColor Red
    exit 1
}
Write-Host "      done — $wasmCount .wasm file(s)." -ForegroundColor Green

# --- summary ---------------------------------------------------------------
Write-Host ""
Write-Host "All assets are in place:" -ForegroundColor Cyan
Get-ChildItem 'public\models', 'public\ort' |
    Select-Object @{n='File';e={$_.FullName.Replace((Get-Location).Path + '\', '')}},
                  @{n='Size';e={"{0,8:N0} KB" -f ($_.Length/1KB)}} |
    Format-Table -AutoSize

Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1. Commit public\models and public\ort along with your code changes."
Write-Host "     (They are static assets — Vercel serves them straight from public/.)"
Write-Host "  2. Check .gitignore does not exclude *.wasm or *.onnx."
Write-Host "  3. Make the edits to vite.config.ts, src\App.tsx and src\pages\Capture.tsx."
Write-Host ""
