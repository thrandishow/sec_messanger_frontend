use crate::{
    api::{Login, Session, Socket},
    model::*,
};
use anyhow::{Result, anyhow, bail, ensure};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{path::PathBuf, time::Duration};
use tokio::{
    sync::mpsc::UnboundedReceiver,
    time::{Instant, timeout},
};
use tokio_tungstenite::tungstenite::Message;

pub enum Command {
    Login(Login),
    Select(String),
    History(String, Option<i64>),
    Send(String, String),
    Upload(String, PathBuf),
    Download(String, PathBuf),
    Reconnect,
    Logout,
}
pub enum Event {
    LoginError(String),
    Account(User, Directory),
    Connected,
    Disconnected(String),
    LoggedOut,
    History(String, Option<i64>, Page),
    Chat(String, Letter),
    Joined(String),
    Sent(String, Option<String>),
    SendError(String),
    Status(String),
}
struct Pending {
    target: String,
    text: String,
    draft: Option<String>,
    deadline: Instant,
}

async fn write(socket: &mut Socket, value: Value) -> Result<()> {
    timeout(
        Duration::from_secs(6),
        socket.send(Message::Text(value.to_string().into())),
    )
    .await??;
    Ok(())
}
fn detail(e: impl std::fmt::Display) -> String {
    format!("{e:#}")
}

pub async fn run(mut input: UnboundedReceiver<Command>, notify: impl Fn(Event)) {
    while let Some(command) = input.recv().await {
        let Command::Login(login) = command else {
            continue;
        };
        let session = match Session::login(login).await {
            Ok(s) => s,
            Err(e) => {
                notify(Event::LoginError(detail(e)));
                continue;
            }
        };
        let directory = match session.directory().await {
            Ok(d) => d,
            Err(e) => {
                let _ = session.logout().await;
                notify(Event::LoginError(detail(e)));
                continue;
            }
        };
        notify(Event::Account(session.user.clone(), directory));
        let mut target = String::new();
        loop {
            let outcome = match session.socket().await {
                Ok(mut stream) => {
                    online(&session, &mut stream, &mut target, &mut input, &notify).await
                }
                Err(e) => Err(e),
            };
            match outcome {
                Ok(Exit::Logout) => break,
                Ok(Exit::Closed) => return,
                Err(e) => notify(Event::Disconnected(detail(e))),
            }
            // An explicit reconnect avoids repeated login attempts when the account is
            // already online on another device, and never replays an unconfirmed send.
            let mut again = false;
            while let Some(cmd) = input.recv().await {
                match cmd {
                    Command::Reconnect => {
                        again = true;
                        break;
                    }
                    Command::Logout => match session.logout().await {
                        Ok(()) => {
                            notify(Event::LoggedOut);
                            break;
                        }
                        Err(e) => notify(Event::Status(detail(e))),
                    },
                    Command::Select(t) => target = t,
                    Command::Send(..) | Command::Upload(..) => {
                        notify(Event::SendError("Нет подключения. Текст сохранён.".into()))
                    }
                    _ => {}
                }
            }
            if !again {
                break;
            }
        }
    }
}
enum Exit {
    Logout,
    Closed,
}
async fn online(
    s: &Session,
    ws: &mut Socket,
    target: &mut String,
    input: &mut UnboundedReceiver<Command>,
    note: &impl Fn(Event),
) -> Result<Exit> {
    let mut ready = false;
    let mut pending: Option<Pending> = None;
    let mut heartbeat = tokio::time::interval_at(
        Instant::now() + Duration::from_secs(25),
        Duration::from_secs(25),
    );
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let handshake = Instant::now() + Duration::from_secs(12);
    loop {
        let deadline = pending.as_ref().map(|p| p.deadline);
        tokio::select! {
            _=tokio::time::sleep_until(handshake), if !ready=>bail!("Сервер не подтвердил подключение."),
            _=async { if let Some(at)=deadline {tokio::time::sleep_until(at).await} else {std::future::pending::<()>().await} }=>{
                bail!("{}",readable_error("MESSAGE_TIMEOUT"));
            }
            _=heartbeat.tick()=>{write(ws,json!({"type":"ping"})).await?;}
            frame=ws.next()=>{
                let frame=frame.ok_or_else(||anyhow!("Соединение закрыто. Нажмите «Подключить»."))??;
                let raw=match frame {
                    Message::Text(v)=>v, Message::Close(_)=>bail!("Соединение закрыто. Нажмите «Подключить»."),
                    Message::Ping(_)=>{ws.flush().await?;continue;}, _=>continue,
                };
                let v:Value=serde_json::from_str(&raw)?;
                match v["type"].as_str() {
                    Some("ready")=>{
                        ensure!(v["nickname"].as_str()==Some(&s.user.nickname),"Сервер вернул другой аккаунт.");
                        ready=true; note(Event::Connected);
                        if target.starts_with('#') {write(ws,json!({"type":"join","channel":target})).await?;}
                        if !target.is_empty(){fetch_history(s,target,None,note).await;}
                    }
                    Some("join") if v["nickname"].as_str()==Some(&s.user.nickname)=>{
                        if let Some(room)=v["channel"].as_str(){note(Event::Joined(room.into()));}
                    }
                    Some("message")=>{
                        let dest=v["target"].as_str().ok_or_else(||anyhow!("Сервер не указал адресата."))?.to_owned();
                        let m:Letter=serde_json::from_value(v)?;
                        let own=m.from==s.user.nickname;
                        let key=if dest.starts_with('#') || own {dest} else {m.from.clone()};
                        if own && pending.as_ref().is_some_and(|p|p.target==key && p.text==m.text) {
                            if let Some(p)=pending.take(){note(Event::Sent(key.clone(),p.draft));}
                        }
                        note(Event::Chat(key,m));
                    }
                    Some("error")=>{
                        let msg=readable_error(v["code"].as_str().unwrap_or("UNKNOWN"));
                        if pending.take().is_some(){note(Event::SendError(msg));}else{note(Event::Status(msg));}
                    }
                    _=>{}
                }
            }
            cmd=input.recv()=>{
                let Some(cmd)=cmd else{return Ok(Exit::Closed)};
                match cmd {
                    Command::Select(new)=>{
                        if *target!=new && ready && target.starts_with('#'){write(ws,json!({"type":"part","channel":target})).await?;}
                        let changed=*target!=new;*target=new;
                        if ready {
                            if changed && target.starts_with('#'){write(ws,json!({"type":"join","channel":target})).await?;}
                            fetch_history(s,target,None,note).await;
                        }
                    }
                    Command::History(t,before)=>{fetch_history(s,&t,before,note).await;}
                    Command::Send(t,text)=>{
                        if !ready || t!=*target || pending.is_some() || !valid_text(&text){note(Event::SendError("Сообщение не отправлено. Проверьте соединение и текст (до 350 байт).".into()));continue;}
                        write(ws,json!({"type":"message","target":t,"text":text})).await?;
                        pending=Some(Pending{target:t,text:text.clone(),draft:Some(text),deadline:Instant::now()+Duration::from_secs(15)});
                    }
                    Command::Upload(t,path)=>{
                        if !ready || t!=*target || pending.is_some(){note(Event::SendError("Дождитесь подключения и подтверждения отправки.".into()));continue;}
                        match s.upload(&t,&path).await {
                            Ok(file)=>{
                                let text=format!("Документ: {}",file.name.chars().take(60).collect::<String>());
                                write(ws,json!({"type":"message","target":t,"text":text,"attachmentId":file.id})).await?;
                                pending=Some(Pending{target:t,text,draft:None,deadline:Instant::now()+Duration::from_secs(15)});
                            }
                            Err(e)=>note(Event::SendError(detail(e))),
                        }
                    }
                    Command::Download(id,path)=>match s.download(&id,&path).await {
                        Ok(())=>note(Event::Status("Файл сохранён.".into())),Err(e)=>note(Event::Status(detail(e))),
                    },
                    Command::Logout=>{
                        match s.logout().await {
                            Ok(())=>{let _=ws.close(None).await;note(Event::LoggedOut);return Ok(Exit::Logout);}
                            Err(e)=>note(Event::Status(detail(e))),
                        }
                    }
                    Command::Login(_)|Command::Reconnect=>{}
                }
            }
        }
    }
}
async fn fetch_history(s: &Session, t: &str, before: Option<i64>, note: &impl Fn(Event)) {
    match s.history(t, before).await {
        Ok(p) => note(Event::History(t.into(), before, p)),
        Err(e) => note(Event::Status(detail(e))),
    }
}
