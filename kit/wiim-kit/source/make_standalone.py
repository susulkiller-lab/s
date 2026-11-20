#!/usr/bin/env python3
"""위임계약서 작성기 단독 실행판 생성기 (관리자용)

게시용 HTML(claude.ai 아티팩트 게시본)을 읽어, 인터넷·Claude 없이 브라우저에서 바로 열리는
단독 실행 HTML을 만든다. 하는 일은 세 가지뿐이며 작성기 본체 코드는 건드리지 않는다.
  1) docx 라이브러리(CDN 주소)를 파일 안에 직접 넣는다.
  2) 저장 함수에 '일반 브라우저 다운로드' 대체 경로를 붙인다(아티팩트 안에서는 기존 경로 그대로).
  3) 문서 껍데기(doctype, head, 기본 스타일)를 씌운다.

사용법
  python3 make_standalone.py <게시용.html> <docx.umd.js> <출력.html>

docx.umd.js 구하기(8.5.0 고정):
  npm pack docx@8.5.0 && tar -xzf docx-8.5.0.tgz   ->  package/build/index.umd.js
"""
import re
import sys


def main(src, lib, out):
    html = open(src, encoding='utf-8').read()
    js = open(lib, encoding='utf-8').read()

    # 1) docx 라이브러리 인라인 (HTML 파서가 오해할 수 있는 문자열은 이스케이프)
    tag = '<script src="https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js"></script>'
    assert html.count(tag) == 1, 'docx 스크립트 태그를 찾지 못했습니다'
    js = js.replace('</script', '<\\/script').replace('<!--', '<\\u0021--').replace('<script', '<\\u0073cript')
    html = html.replace(tag, '<script>\n' + js + '\n</script>')

    # 2) 저장 대체 경로: window.claude 가 없을 때만 일반 다운로드
    old = ("    if (!dlP) dlP = (window.claude && window.claude.use) ? "
           "window.claude.use('downloads').catch(function () { return null; }) : Promise.resolve(null);")
    new = ("    if (!dlP) dlP = (window.claude && window.claude.use) ? "
           "window.claude.use('downloads').catch(function () { return null; }) : Promise.resolve(localSaver());")
    assert html.count(old) == 1, 'downloads() 코드를 찾지 못했습니다'
    html = html.replace(old, new)
    anchor = '  var dlP = null;\n'
    assert html.count(anchor) == 1, 'dlP 선언을 찾지 못했습니다'
    saver = (
        "  /* 단독 실행판: 일반 브라우저 다운로드 */\n"
        "  function localSaver() {\n"
        "    return { save: function (o) {\n"
        "      return new Promise(function (resolve) {\n"
        "        var a = document.createElement('a'), u = URL.createObjectURL(o.data);\n"
        "        a.href = u; a.download = o.filename; a.style.display = 'none';\n"
        "        document.body.appendChild(a); a.click();\n"
        "        setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(u); resolve(); }, 500);\n"
        "      });\n"
        "    } };\n"
        "  }\n"
    )
    html = html.replace(anchor, saver + anchor)

    # 3) 문서 껍데기: <title>은 head로 옮긴다
    m = re.match(r'\s*(<title>.*?</title>)\s*', html, re.S)
    assert m, '<title>로 시작해야 합니다'
    title = m.group(1)
    body = html[m.end():]
    head = ('<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width,initial-scale=1">\n' + title + '\n'
            '<style>html{box-sizing:border-box}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;'
            'background:#eceff2;color:#141413}img{max-width:100%}[hidden]{display:none!important}</style>\n</head>\n<body>\n')
    open(out, 'w', encoding='utf-8').write(head + body.rstrip() + '\n</body>\n</html>\n')
    print('wrote', out, len(head + body), 'chars')


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
