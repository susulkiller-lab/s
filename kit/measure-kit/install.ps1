# 진앤솔 마케팅 측정 프로그램 설치(윈도우). '설치하기.bat'을 더블클릭하면 이 파일이 실행된다.
# 하는 일: 크롬·파이썬·Git·Claude Code 설치 → 저장소 받기 → 파이썬 패키지 → 바탕화면 바로가기 → 로그인 안내
$ErrorActionPreference = 'Continue'
$Repo   = 'https://github.com/susulkiller-lab/s.git'
$Branch = 'claude/hopeful-brahmagupta-qfk7of'
$Target = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'GitHub\s'
$Todo   = New-Object System.Collections.Generic.List[string]

function Step($t) { Write-Host ''; Write-Host "===== $t =====" -ForegroundColor Cyan }
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function RefreshPath {
    $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $u = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$m;$u;$env:USERPROFILE\.local\bin"
}
function WingetInstall($id, $name, $override) {
    Write-Host "$name 설치 중..."
    if ($override) {
        winget install --id $id -e --accept-source-agreements --accept-package-agreements --override $override | Out-Host
    } else {
        winget install --id $id -e --silent --accept-source-agreements --accept-package-agreements | Out-Host
    }
    RefreshPath
}

Step '1/7 설치 도구 확인'
if (-not (Has 'winget')) {
    Write-Host 'winget(앱 설치 관리자)이 없습니다. Microsoft Store가 열리면 "앱 설치 관리자"를 설치하거나 업데이트한 뒤 다시 실행하세요.' -ForegroundColor Yellow
    Start-Process 'ms-windows-store://pdp/?productid=9NBLGGH4NNS1'
    Read-Host '끝내려면 Enter'
    exit 1
}
Write-Host 'winget 확인'

Step '2/7 크롬·파이썬·Git'
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
            "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
            "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ }
if ($chrome) { Write-Host '크롬 있음' } else { WingetInstall 'Google.Chrome' '크롬' }
if (Has 'py') { Write-Host "파이썬 있음: $(py --version 2>&1)" } else {
    WingetInstall 'Python.Python.3.13' '파이썬 3.13' '/quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1'
    $launcher = Join-Path $env:LOCALAPPDATA 'Programs\Python\Launcher'
    if (-not (Has 'py') -and (Test-Path (Join-Path $launcher 'py.exe'))) {
        $u = [Environment]::GetEnvironmentVariable('Path', 'User')
        [Environment]::SetEnvironmentVariable('Path', "$u;$launcher", 'User')
        RefreshPath
    }
}
if (Has 'git') { Write-Host "Git 있음: $(git --version)" } else { WingetInstall 'Git.Git' 'Git' }
RefreshPath
if (-not (Has 'py'))  { $Todo.Add('파이썬이 잡히지 않습니다. PC를 다시 시작한 뒤 설치하기.bat을 한 번 더 실행하세요.') }
if (-not (Has 'git')) { $Todo.Add('Git이 잡히지 않습니다. PC를 다시 시작한 뒤 설치하기.bat을 한 번 더 실행하세요.') }

Step '3/7 Claude Code'
if (Has 'claude') { Write-Host "Claude Code 있음: $(claude --version 2>&1)" } else {
    Write-Host 'Claude Code 설치 중...'
    Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
    RefreshPath
    if (-not (Has 'claude')) { $Todo.Add('Claude Code 설치를 확인하지 못했습니다. 새 창에서 claude --version 을 입력해 보세요.') }
}

Step '4/7 측정 프로그램 받기(처음이면 GitHub 로그인 창이 뜹니다)'
if (Has 'git') {
    if (Test-Path (Join-Path $Target '.git')) {
        git -C $Target fetch origin $Branch | Out-Host
        git -C $Target checkout $Branch | Out-Host
        git -C $Target pull --ff-only origin $Branch | Out-Host
    } else {
        New-Item -ItemType Directory -Force -Path (Split-Path $Target) | Out-Null
        git clone -b $Branch $Repo $Target | Out-Host
    }
    if (Test-Path (Join-Path $Target '.git')) {
        if (-not (git -C $Target config user.name))  { git -C $Target config user.name 'jinnsol-measure-pc' }
        if (-not (git -C $Target config user.email)) { git -C $Target config user.email 'susulkiller-lab@users.noreply.github.com' }
        Write-Host "위치: $Target"
    } else { $Todo.Add('저장소를 받지 못했습니다. GitHub 로그인 후 다시 실행하세요.') }
}

Step '5/7 파이썬 패키지'
if (Has 'py') { py -m pip install -q --upgrade playwright python-docx | Out-Host; Write-Host 'playwright, python-docx 설치' }

Step '6/7 바탕화면 바로가기'
$bat = Join-Path $Target '원클릭리포트.bat'
if (Test-Path $bat) {
    $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) '진앤솔 마케팅 리포트.lnk'
    $sh = New-Object -ComObject WScript.Shell
    $s = $sh.CreateShortcut($lnk)
    $s.TargetPath = $bat
    $s.WorkingDirectory = $Target
    $s.Save()
    Write-Host "바탕화면에 '진앤솔 마케팅 리포트' 바로가기를 만들었습니다."
} else { $Todo.Add('원클릭리포트.bat이 없어 바로가기를 만들지 못했습니다.') }

Step '7/7 로그인(한 번만)'
Write-Host '크롬에서 탭이 열립니다: Claude 확장(Chrome에 추가 → 로그인), ChatGPT, Gemini, Perplexity 로그인'
$urls = @('https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn',
          'https://chatgpt.com/', 'https://gemini.google.com/', 'https://www.perplexity.ai/')
$chromeExe = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
               "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
               "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($chromeExe) { Start-Process $chromeExe -ArgumentList $urls }  # 기본 브라우저가 엣지여도 크롬으로 연다
else { $urls | ForEach-Object { Start-Process $_ }; $Todo.Add('크롬을 찾지 못했습니다. 크롬 설치 후 Claude 확장을 설치하세요.') }
if ((Has 'claude') -and (Test-Path $Target)) {
    Write-Host ''
    Write-Host '이어서 Claude Code 창을 엽니다. 처음이면 /login 으로 구독 계정 로그인 → /chrome 에서 Status: Enabled 확인 → /exit' -ForegroundColor Yellow
    Read-Host '크롬 확장 로그인을 마쳤으면 Enter'
    Start-Process cmd.exe -ArgumentList '/k', "cd /d `"$Target`" && claude --chrome"
}

Write-Host ''
Write-Host '===== 설치 끝 =====' -ForegroundColor Green
if ($Todo.Count) { $Todo | ForEach-Object { Write-Host "확인: $_" -ForegroundColor Yellow } } else { Write-Host "이제 바탕화면의 '진앤솔 마케팅 리포트'를 더블클릭하면 측정부터 리포트까지 자동으로 진행됩니다." }
Read-Host '닫으려면 Enter'
