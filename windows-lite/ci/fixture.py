"""Loopback-only HTTPS/WSS fixture for the release smoke test."""
import asyncio
import os
import ssl
from pathlib import Path
from aiohttp import web
import trustme

root = Path(os.environ['RUNNER_TEMP'])
ca = trustme.CA()
ca.cert_pem.write_to_path(root / 'shifr-test-ca.crt')
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ca.issue_cert('localhost', '127.0.0.1').configure_cert(ctx)
nickname = 'qa_user'
user = {'nickname': nickname, 'role': 'member'}

async def handler(req):
    if req.headers.get('Origin') != 'https://' + req.host:
        return web.json_response({'error': 'ORIGIN_DENIED'}, status=403)
    if req.path == '/api/auth/login':
        if (await req.json()) != {'nickname':nickname, 'password':'fixture-password'}:
            return web.json_response({'error':'INVALID_CREDENTIALS'},status=401)
        response=web.json_response({'user':user})
        response.set_cookie('shifr_session','fixture-only',secure=True,httponly=True)
        return response
    if req.cookies.get('shifr_session')!='fixture-only':
        return web.json_response({'error':'UNAUTHORIZED'},status=401)
    if req.path=='/api/directory':
        return web.json_response({'channels':[{'channel':'#general','name':'Общий чат'}],'users':[{'nickname':'colleague'}]})
    if req.path=='/api/history':
        return web.json_response({'messages':[{'id':1,'from':'colleague','text':'Test history','time':'2026-11-19T09:00:00Z'}],'nextBefore':None})
    if req.path=='/api/auth/logout':
        return web.json_response({})
    if req.path!='/ws':raise web.HTTPNotFound()
    ws=web.WebSocketResponse()
    await ws.prepare(req)
    await ws.send_json({'type':'ready','nickname':nickname})
    async for msg in ws:
        data=msg.json()
        if data['type']=='join':
            await ws.send_json({'type':'join','channel':data['channel'],'nickname':nickname})
        if data['type']=='message':
            await ws.send_json({'type':'message','target':data['target'],'from':nickname,'text':data['text'],'id':2,'time':'2026-11-19T09:02:00Z'})
    return ws

async def main():
    app=web.Application()
    app.router.add_route('*','/{path:.*}',handler)
    runner=web.AppRunner(app)
    await runner.setup()
    site=web.TCPSite(runner,'127.0.0.1',0,ssl_context=ctx)
    await site.start()
    (root/'shifr-test-port').write_text(str(runner.addresses[0][1]),encoding='ascii')
    await asyncio.Event().wait()
asyncio.run(main())
