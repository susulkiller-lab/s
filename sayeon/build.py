#!/usr/bin/env python3
"""사건 연표 빌드: src/ 파일을 정해진 순서로 이어 붙여 build/sayeon.html 을 만든다(설계서 2, 4).

사용법
  python3 build.py              # build/sayeon.html 생성
  python3 build.py --out x.html # 다른 경로로

출력 순서(문서 뼈대 태그 <!doctype>/<html>/<head>/<body> 없음. 게시할 때 플랫폼이 감싼다)
  1. <title>사건 연표</title>
  2. Google Fonts <link> (Noto Sans KR, Noto Serif KR)
  3. <style>: tokens.css, shell.css, viz_timeline.css, viz_map.css, ingest.css, 그 밖의 src/*.css(이름순)
  4. 본문 마크업: shell.html
  5. CDN <script src> 3개(pdf.js 3.11.174, mammoth 1.6.0, jszip 3.10.1; cdnjs 만)
  6. 인라인 <script>: common.js, viz_timeline.js, viz_map.js, viz_a4.js, ingest.js, pipeline.js, store.js, shell.js
없는 src 파일은 건너뛰고 경고한다(껍데기 필수 파일이 없으면 실패). 인라인 스크립트 안의 '</script' 는 '<\\/script' 로 바꾸고 경고한다.
종료 코드: 오류 1, 정상 0.
"""
import os
import re
import sys

R = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(R, 'src')

CSS_ORDER = ['tokens.css', 'shell.css', 'viz_timeline.css', 'viz_map.css', 'ingest.css']
JS_ORDER = ['common.js', 'viz_timeline.js', 'viz_map.js', 'viz_a4.js', 'ingest.js', 'pipeline.js', 'store.js', 'shell.js']
REQUIRED = {'tokens.css', 'shell.css', 'shell.html', 'common.js', 'store.js', 'shell.js'}
CDN = [
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
]
FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700'
    '&family=Noto+Serif+KR:wght@400;700&display=swap">'
)
SIZE_LIMIT = 16 * 1024 * 1024  # 아티팩트 페이지 상한

warnings = []
errors = []


def read(name):
    p = os.path.join(SRC, name)
    if not os.path.exists(p):
        (errors if name in REQUIRED else warnings).append('src/%s 없음%s' % (name, '' if name in REQUIRED else ' - 건너뜀'))
        return None
    with open(p, encoding='utf-8') as f:
        return f.read()


def main(argv):
    out = os.path.join(R, 'build', 'sayeon.html')
    if '--out' in argv:
        out = os.path.abspath(argv[argv.index('--out') + 1])

    sizes = []
    # CSS
    css_parts = []
    others = sorted(n for n in os.listdir(SRC) if n.endswith('.css') and n not in CSS_ORDER) if os.path.isdir(SRC) else []
    for name in CSS_ORDER + others:
        s = read(name)
        if s is None:
            continue
        if re.search(r'</style', s, re.I):
            errors.append('src/%s 에 </style 이 있음' % name)
        css_parts.append('/* ---- %s ---- */\n%s' % (name, s.rstrip()))
        sizes.append((name, len(s.encode('utf-8'))))
        if name in others:
            warnings.append('src/%s: 정해진 순서 목록 밖의 CSS 라 뒤에 붙임' % name)

    # 본문 마크업
    markup = read('shell.html') or ''
    if re.search(r'<!doctype|<html[\s>]|<head[\s>]|<body[\s>]|</html>|</head>|</body>', markup, re.I):
        errors.append('src/shell.html 에 문서 뼈대 태그가 있음(<!doctype>/<html>/<head>/<body> 금지)')
    if markup:
        sizes.append(('shell.html', len(markup.encode('utf-8'))))

    # 인라인 JS
    js_parts = []
    for name in JS_ORDER:
        s = read(name)
        if s is None:
            continue
        n_close = len(re.findall(r'</script', s, re.I))
        if n_close:
            s = re.sub(r'</(script)', r'<\\/\1', s, flags=re.I)
            warnings.append('src/%s: </script %d곳을 <\\/script 로 바꿈' % (name, n_close))
        if '<!--' in s:
            warnings.append('src/%s: 인라인 스크립트 안에 "<!--" 가 있음(HTML 파서 주의)' % name)
        js_parts.append('<script>\n/* ---- %s ---- */\n%s\n</script>' % (name, s.rstrip()))
        sizes.append((name, len(s.encode('utf-8'))))

    if errors:
        for e in errors:
            print('오류:', e, file=sys.stderr)
        for w in warnings:
            print('경고:', w, file=sys.stderr)
        return 1

    html = '\n'.join([
        '<title>사건 연표</title>',
        FONTS,
        '<style>\n' + '\n'.join(css_parts) + '\n</style>',
        markup.strip(),
        '\n'.join('<script src="%s"></script>' % u for u in CDN),
        '\n'.join(js_parts),
    ]) + '\n'

    total = len(html.encode('utf-8'))
    if total > SIZE_LIMIT:
        print('오류: 결과 %d바이트가 16MB 를 넘음' % total, file=sys.stderr)
        return 1
    # 최종 점검: 인라인 스크립트 수 = 닫는 태그 수
    n_open = len(re.findall(r'<script\b', html, re.I))
    n_close = len(re.findall(r'</script>', html, re.I))
    if n_open != n_close:
        print('오류: <script> %d개, </script> %d개로 짝이 맞지 않음' % (n_open, n_close), file=sys.stderr)
        return 1
    if not html.startswith('<title>사건 연표</title>'):
        print('오류: 결과가 <title>사건 연표</title> 로 시작하지 않음', file=sys.stderr)
        return 1

    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)

    for w in warnings:
        print('경고:', w)
    for name, b in sizes:
        print('  %-18s %9d 바이트' % (name, b))
    print('생성: %s (%d바이트, 인라인 스크립트 %d개, CDN 3개)' % (os.path.relpath(out, R), total, len(js_parts)))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
