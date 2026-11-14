param([switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

function Get-FiveBuysNodePath {
    $installed = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($installed) { return $installed.Source }
    foreach ($candidate in @((Join-Path $env:ProgramFiles 'nodejs\node.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'))) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    throw 'Instala Node.js LTS desde https://nodejs.org/en/download y vuelve a abrir INICIAR-APP. El README muestra los pasos.'
}

function Get-FiveBuysFreePort {
    foreach ($candidate in 3001..3010) {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidate)
        try { $listener.Start(); return $candidate } catch { } finally { $listener.Stop() }
    }
    throw 'No hay un puerto libre. Cierra las ventanas anteriores de FiveBuys y vuelve a intentarlo.'
}


function Get-FiveBuysStartError([string]$details) {
    $messages = @(
        'No se reconoce STRIPE_SECRET_KEY. Usa una línea con el formato STRIPE_SECRET_KEY=sk_test_ seguido de tu clave.',
        'El archivo de configuración está incompleto. Guárdalo de nuevo como UTF-8.',
        'Deja una sola línea STRIPE_SECRET_KEY en el archivo env.',
        'La clave secreta debe comenzar con sk_test_. Usa el entorno de pruebas de Stripe.',
        'La clave publicable, si la incluyes, debe comenzar con pk_test_.',
        'No se encontró env. Sigue el paso Configurar Stripe del README.',
        'Hay dos archivos de configuración. Deja uno solo: env o .env.',
        'El puerto está ocupado. Cierra esta ventana y vuelve a abrir INICIAR-APP.'
    )
    foreach ($message in $messages) {
        if ($details.Contains($message)) { return $message }
    }
    if ($details -match 'ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find package|Cannot find module') {
        return 'Faltan dependencias de la aplicación. Es necesario restaurar las dependencias existentes.'
    }
    return 'FiveBuys no pudo iniciar. No se mostraron detalles técnicos para proteger tus claves.'
}

if ($VerifyOnly) {
    $null = Get-FiveBuysNodePath
    $null = Get-FiveBuysFreePort
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'start-app.mjs'))) { throw 'Falta el iniciador.' }
    if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'package-lock.json'))) { throw 'Faltan las dependencias declaradas.' }
    Write-Output 'Inicio verificado sin abrir archivos de claves ni conectar con Stripe.'
    exit 0
}

$nodeProcess = $null
try {
    $nodePath = Get-FiveBuysNodePath
    if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'node_modules\express\package.json'))) {
        $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if (-not $npm) { throw 'Instala Node.js LTS siguiendo el README y vuelve a intentarlo.' }
        Write-Host 'Preparando la aplicación por primera vez. Espera a que termine...'
        Push-Location $appRoot
        try {
            & $npm.Source ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar la aplicación. Comprueba Internet y vuelve a abrir INICIAR-APP.' }
        } finally { Pop-Location }
    }
    $port = Get-FiveBuysFreePort
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $nodePath
    $start.WorkingDirectory = $appRoot
    $start.Arguments = '"' + (Join-Path $PSScriptRoot 'start-app.mjs') + '"'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardError = $true
    $start.EnvironmentVariables['PORT'] = [string]$port
    $start.EnvironmentVariables['DOTENV_CONFIG_PATH'] = 'NUL'
    $start.EnvironmentVariables['DOTENV_CONFIG_QUIET'] = 'true'
    $nodeProcess = [Diagnostics.Process]::Start($start)
    $url = 'http://127.0.0.1:' + $port
    $ready = $false
    foreach ($attempt in 1..60) {
        if ($nodeProcess.HasExited) { throw (Get-FiveBuysStartError ($nodeProcess.StandardError.ReadToEnd())) }
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $ready) { throw 'La aplicación no respondió. Cierra esta ventana y vuelve a intentarlo.' }
    Write-Host ('FiveBuys está abierto en ' + $url)
    Write-Host 'Mantén esta ventana abierta. Para terminar, pulsa Ctrl+C aquí.'
    Start-Process $url
    while (-not $nodeProcess.HasExited) { Start-Sleep -Milliseconds 200 }
} catch {
    Write-Host $_.Exception.Message
    exit 1
} finally {
    if ($nodeProcess -and -not $nodeProcess.HasExited) { $nodeProcess.Kill() }
}
