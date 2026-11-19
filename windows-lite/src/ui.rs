use crate::{
    api::Login,
    model::*,
    worker::{self, Command, Event as Update},
};
use native_windows_derive::NwgUi;
use nwg::NativeUi;
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    path::PathBuf,
    sync::mpsc,
};
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};

#[derive(Default)]
struct View {
    account: Option<User>,
    chats: Vec<(String, String)>,
    shown: Vec<String>,
    target: String,
    timeline: Timeline,
    drafts: HashMap<String, String>,
    unseen: HashMap<String, u32>,
    attachments: Vec<Attachment>,
    connected: bool,
    joined: bool,
    pending: bool,
}

#[derive(Default, NwgUi)]
pub struct App {
    #[nwg_control(size:(450,322), title:"Шифр-связь — Вход", flags:"WINDOW|MINIMIZE_BOX|VISIBLE")]
    #[nwg_events(OnWindowClose:[nwg::stop_thread_dispatch()])]
    login: nwg::Window,
    #[nwg_control(parent:login,text:"Адрес сервера",position:(18,14),size:(410,20))]
    address_label: nwg::Label,
    #[nwg_control(parent:login,position:(18,38),size:(414,28),placeholder_text:Some("192.168.1.10:8443"),focus:true)]
    address: nwg::TextInput,
    #[nwg_control(parent:login,text:"Ник",position:(18,75),size:(195,20))]
    nick_label: nwg::Label,
    #[nwg_control(parent:login,text:"Пароль",position:(233,75),size:(195,20))]
    password_label: nwg::Label,
    #[nwg_control(parent:login,position:(18,98),size:(198,28),limit:24)]
    nick: nwg::TextInput,
    #[nwg_control(parent:login,position:(233,98),size:(199,28),limit:128,password:Some('●'))]
    #[nwg_events(OnKeyEnter:[App::sign_in])]
    password: nwg::TextInput,
    #[nwg_control(parent:login,text:"Корневой сертификат сервера",position:(18,141),size:(414,20))]
    ca_label: nwg::Label,
    #[nwg_control(parent:login,text:"Выбрать ca.crt…",position:(18,165),size:(150,30))]
    #[nwg_events(OnButtonClick:[App::certificate])]
    ca_button: nwg::Button,
    #[nwg_control(parent:login,text:"Доверенные сертификаты Windows",position:(179,171),size:(253,24))]
    ca_name: nwg::Label,
    #[nwg_control(parent:login,text:"Войти",position:(18,211),size:(414,35))]
    #[nwg_events(OnButtonClick:[App::sign_in])]
    enter: nwg::Button,
    #[nwg_control(parent:login,text:"Подключитесь к локальной сети сервера.",position:(18,255),size:(414,62))]
    login_status: nwg::Label,

    #[nwg_control(size:(880,540),title:"Шифр-связь — Чаты",flags:"MAIN_WINDOW")]
    #[nwg_events(OnWindowClose:[nwg::stop_thread_dispatch()], OnResize:[App::resize], OnMinMaxInfo:[App::min_size(EVT_DATA)])]
    window: nwg::Window,
    #[nwg_control(parent:window,text:"Чаты")]
    caption: nwg::Label,
    #[nwg_control(parent:window,placeholder_text:Some("Поиск чата или сотрудника"))]
    #[nwg_events(OnTextInput:[App::filter])]
    search: nwg::TextInput,
    #[nwg_control(parent:window)]
    #[nwg_events(OnListBoxSelect:[App::select])]
    chats: nwg::ListBox<String>,
    #[nwg_control(parent:window,text:"Сообщения")]
    title: nwg::Label,
    #[nwg_control(parent:window,text:"Раньше")]
    #[nwg_events(OnButtonClick:[App::older])]
    earlier: nwg::Button,
    #[nwg_control(parent:window,text:"К новым")]
    #[nwg_events(OnButtonClick:[App::latest])]
    newest: nwg::Button,
    #[nwg_control(parent:window,readonly:true,flags:"VISIBLE|VSCROLL|AUTOVSCROLL|TAB_STOP",limit:160000)]
    history: nwg::TextBox,
    #[nwg_control(parent:window)]
    files: nwg::ComboBox<String>,
    #[nwg_control(parent:window,text:"Сохранить…")]
    #[nwg_events(OnButtonClick:[App::save_file])]
    save: nwg::Button,
    #[nwg_control(parent:window,placeholder_text:Some("Сообщение"),limit:350)]
    #[nwg_events(OnKeyEnter:[App::send])]
    draft: nwg::TextInput,
    #[nwg_control(parent:window,text:"Файл…")]
    #[nwg_events(OnButtonClick:[App::attach])]
    attach: nwg::Button,
    #[nwg_control(parent:window,text:"Отправить")]
    #[nwg_events(OnButtonClick:[App::send])]
    send_btn: nwg::Button,
    #[nwg_control(parent:window,text:"Подключение…")]
    status: nwg::Label,
    #[nwg_control(parent:window,text:"Подключить")]
    #[nwg_events(OnButtonClick:[App::reconnect])]
    retry: nwg::Button,
    #[nwg_control(parent:window,text:"Выйти")]
    #[nwg_events(OnButtonClick:[App::logout])]
    logout_btn: nwg::Button,
    #[nwg_control(parent:login)]
    #[nwg_events(OnNotice:[App::receive])]
    notice: nwg::Notice,

    tx: RefCell<Option<UnboundedSender<Command>>>,
    rx: RefCell<Option<mpsc::Receiver<Update>>>,
    ca: RefCell<Option<PathBuf>>,
    state: RefCell<View>,
    filtering: Cell<bool>,
}

impl App {
    fn start(&self) {
        if let Some(saved) = crate::preferences::Preferences::load() {
            self.address.set_text(&saved.address);
            self.nick.set_text(&saved.nickname);
            if let Some(path) = &saved.ca_file {
                self.ca_name
                    .set_text(&path.file_name().unwrap_or_default().to_string_lossy());
            }
            self.ca.replace(saved.ca_file);
        }
        let (tx, commands) = unbounded_channel();
        let (events, rx) = mpsc::channel();
        self.tx.replace(Some(tx));
        self.rx.replace(Some(rx));
        let notice = self.notice.sender();
        std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("network runtime");
            runtime.block_on(worker::run(commands, |event| {
                if events.send(event).is_ok() {
                    notice.notice();
                }
            }));
        });
    }
    fn queue(&self, c: Command) {
        if let Some(tx) = self.tx.borrow().as_ref() {
            let _ = tx.send(c);
        }
    }
    fn min_size(data: &nwg::EventData) {
        data.on_min_max().set_min_size(660, 400);
    }
    fn resize(&self) {
        let (w, h) = self.window.size();
        let (w, h) = (w as i32, h as i32);
        let left = (w / 4).clamp(160, 255);
        let x = left + 23;
        let right = w - x - 12;
        macro_rules! place {
            ($c:ident,$x:expr,$y:expr,$w:expr,$h:expr) => {{
                self.$c.set_position($x, $y);
                self.$c.set_size(($w).max(1) as u32, ($h).max(1) as u32);
            }};
        }
        place!(caption, 12, 12, left, 23);
        place!(search, 12, 42, left, 29);
        place!(chats, 12, 77, left, h - 126);
        place!(title, x, 15, right - 162, 24);
        place!(earlier, w - 164, 8, 72, 30);
        place!(newest, w - 86, 8, 74, 30);
        place!(history, x, 44, right, h - 178);
        place!(files, x, h - 127, right - 108, 180);
        place!(save, w - 113, h - 128, 101, 28);
        place!(draft, x, h - 89, right - 164, 34);
        place!(attach, w - 169, h - 89, 58, 34);
        place!(send_btn, w - 105, h - 89, 93, 34);
        place!(status, 12, h - 39, w - 205, 34);
        place!(retry, w - 189, h - 41, 100, 30);
        place!(logout_btn, w - 82, h - 41, 70, 30);
    }
    fn file(
        &self,
        parent: &nwg::Window,
        action: nwg::FileDialogAction,
        title: &str,
    ) -> Option<PathBuf> {
        let mut d = nwg::FileDialog::default();
        if let Err(e) = nwg::FileDialog::builder()
            .title(title)
            .action(action)
            .build(&mut d)
        {
            nwg::modal_error_message(parent, "Файлы", &e.to_string());
            return None;
        }
        if !d.run(Some(parent)) {
            return None;
        }
        d.get_selected_item().ok().map(PathBuf::from)
    }
    fn certificate(&self) {
        if let Some(path) = self.file(
            &self.login,
            nwg::FileDialogAction::Open,
            "Выберите публичный ca.crt",
        ) {
            self.ca_name
                .set_text(&path.file_name().unwrap_or_default().to_string_lossy());
            self.ca.replace(Some(path));
        }
    }
    fn sign_in(&self) {
        if !self.enter.enabled() {
            return;
        }
        if self.nick.text().trim().is_empty() || self.password.text().is_empty() {
            self.login_status.set_text("Введите ник и пароль.");
            return;
        }
        self.enter.set_enabled(false);
        self.login_status.set_text("Подключение к серверу…");
        self.queue(Command::Login(Login {
            address: self.address.text(),
            nick: self.nick.text(),
            password: self.password.text(),
            ca: self.ca.borrow().clone(),
        }));
    }
    fn receive(&self) {
        loop {
            let next = self.rx.borrow().as_ref().and_then(|r| r.try_recv().ok());
            let Some(event) = next else { break };
            match event {
                Update::LoginError(e) => {
                    self.login_status.set_text(&e);
                    self.enter.set_enabled(true);
                }
                Update::Account(u, d) => {
                    crate::preferences::Preferences {
                        address: self.address.text(),
                        nickname: u.nickname.clone(),
                        ca_file: self.ca.borrow().clone(),
                    }
                    .save();
                    let nick = u.nickname.clone();
                    let mut chats: Vec<_> = d
                        .channels
                        .into_iter()
                        .map(|c| (c.channel, c.name))
                        .collect();
                    chats.extend(
                        d.users
                            .into_iter()
                            .filter(|v| v.nickname != nick)
                            .map(|v| (v.nickname.clone(), v.nickname)),
                    );
                    let first = chats.first().map(|(t, _)| t.clone());
                    self.state.replace(View {
                        account: Some(u),
                        chats,
                        ..Default::default()
                    });
                    self.password.set_text("");
                    self.search.set_text("");
                    self.draft.set_text("");
                    self.history.set_text("");
                    self.window.set_text(&format!("Шифр-связь — {nick}"));
                    self.status.set_text("Подключаемся к чату…");
                    self.login.set_visible(false);
                    self.window.set_visible(true);
                    self.resize();
                    self.filter();
                    if let Some(t) = first {
                        self.open(t);
                    }
                }
                Update::Connected => {
                    self.state.borrow_mut().connected = true;
                    self.status.set_text("В сети");
                    self.controls();
                }
                Update::Disconnected(e) => {
                    {
                        let mut s = self.state.borrow_mut();
                        s.connected = false;
                        s.joined = false;
                        s.pending = false;
                    }
                    self.status.set_text(&e);
                    self.controls();
                }
                Update::LoggedOut => {
                    self.state.replace(View::default());
                    self.draft.set_text("");
                    self.history.set_text("");
                    self.window.set_visible(false);
                    self.enter.set_enabled(true);
                    self.login_status.set_text("Вы вышли из аккаунта.");
                    self.login.set_visible(true);
                    self.password.set_focus();
                }
                Update::History(t, before, page) => {
                    if self.state.borrow().target == t {
                        self.state.borrow_mut().timeline.page(page, before);
                        self.render();
                        self.controls();
                    }
                }
                Update::Joined(t) => {
                    if self.state.borrow().target == t {
                        self.state.borrow_mut().joined = true;
                        self.controls();
                    }
                }
                Update::Chat(t, m) => {
                    let active = self.state.borrow().target == t;
                    if active {
                        let past = self.state.borrow().timeline.browsing_past;
                        self.state.borrow_mut().timeline.live(m);
                        if past {
                            self.status
                                .set_text("Есть новые сообщения. Нажмите «К новым».");
                        } else {
                            self.render();
                        }
                    } else {
                        let mut s = self.state.borrow_mut();
                        if !s.chats.iter().any(|(key, _)| key == &t) {
                            s.chats.push((t.clone(), t.clone()));
                        }
                        *s.unseen.entry(t).or_default() += 1;
                        drop(s);
                        self.filter();
                    }
                }
                Update::Sent(t, text) => {
                    self.state.borrow_mut().pending = false;
                    if self.state.borrow().target == t
                        && text.as_deref() == Some(&self.draft.text())
                    {
                        self.draft.set_text("");
                    }
                    self.status.set_text("Принято сервером");
                    self.controls();
                    self.draft.set_focus();
                }
                Update::SendError(e) => {
                    self.state.borrow_mut().pending = false;
                    self.status.set_text(&e);
                    self.controls();
                }
                Update::Status(e) => {
                    self.status.set_text(&e);
                }
            }
        }
    }
    fn filter(&self) {
        if self.filtering.replace(true) {
            return;
        }
        let query = self.search.text().to_lowercase();
        let mut s = self.state.borrow_mut();
        let mut keys = Vec::new();
        let mut labels = Vec::new();
        for (key, name) in &s.chats {
            if !name.to_lowercase().contains(&query) && !key.contains(&query) {
                continue;
            }
            let n = s.unseen.get(key).copied().unwrap_or(0);
            labels.push(if n > 0 {
                format!("{name}  ({n})")
            } else {
                name.clone()
            });
            keys.push(key.clone());
        }
        let i = keys.iter().position(|k| k == &s.target);
        s.shown = keys;
        drop(s);
        self.chats.set_collection(labels);
        self.chats.set_selection(i);
        self.filtering.set(false);
    }
    fn select(&self) {
        if self.filtering.get() {
            return;
        }
        let t = self
            .chats
            .selection()
            .and_then(|i| self.state.borrow().shown.get(i).cloned());
        if let Some(t) = t {
            self.open(t);
        }
    }
    fn open(&self, t: String) {
        let mut s = self.state.borrow_mut();
        if s.target == t {
            return;
        }
        let old = s.target.clone();
        if !old.is_empty() {
            s.drafts.insert(old, self.draft.text());
        }
        s.target = t.clone();
        s.unseen.remove(&t);
        s.timeline = Timeline::default();
        s.joined = false;
        let draft = s.drafts.remove(&t).unwrap_or_default();
        let name = s
            .chats
            .iter()
            .find(|(k, _)| k == &t)
            .map(|(_, n)| n.as_str())
            .unwrap_or(&t)
            .to_owned();
        drop(s);
        self.title.set_text(&name);
        self.draft.set_text(&draft);
        self.render();
        self.filter();
        self.controls();
        self.queue(Command::Select(t));
    }
    fn controls(&self) {
        let s = self.state.borrow();
        let online = s.connected && !s.target.is_empty();
        let permitted =
            s.target != "#announcements" || s.account.as_ref().is_some_and(|u| u.role != "member");
        let can = online && (!s.target.starts_with('#') || s.joined) && !s.pending && permitted;
        self.draft.set_enabled(can);
        self.draft.set_placeholder_text(Some(if permitted {
            "Сообщение"
        } else {
            "Объявления публикуют модераторы"
        }));
        self.attach.set_enabled(can);
        self.send_btn.set_enabled(can);
        self.chats.set_enabled(!s.pending);
        self.retry.set_enabled(!s.connected);
        self.earlier
            .set_enabled(online && s.timeline.older.is_some());
        self.newest.set_enabled(online);
        self.save.set_enabled(online && !s.attachments.is_empty());
    }
    fn render(&self) {
        use std::fmt::Write;
        let mut s = self.state.borrow_mut();
        let mut text = String::new();
        let mut files = Vec::new();
        for m in s.timeline.messages.values() {
            let time = m.time.get(..16).unwrap_or(&m.time).replace('T', " ");
            let _ = write!(text, "{}  ·  {} UTC\r\n{}\r\n\r\n", m.from, time, m.text);
            if let Some(f) = &m.attachment {
                files.push(f.clone());
            }
        }
        let old = self
            .files
            .selection()
            .and_then(|i| s.attachments.get(i))
            .map(|a| a.id.clone());
        let i = old
            .and_then(|id| files.iter().position(|a| a.id == id))
            .or_else(|| (!files.is_empty()).then_some(0));
        self.files
            .set_collection(files.iter().map(|f| f.name.clone()).collect());
        self.files.set_selection(i);
        s.attachments = files;
        self.history.set_text(text.trim_end());
        if !s.timeline.browsing_past {
            self.history.scroll_lastline();
        }
        self.save
            .set_enabled(s.connected && !s.attachments.is_empty());
    }
    fn send(&self) {
        if !self.send_btn.enabled() {
            return;
        }
        let text = self.draft.text();
        if !valid_text(&text) {
            self.status
                .set_text("Введите текст в одну строку, до 350 байт.");
            return;
        }
        let t = self.state.borrow().target.clone();
        self.state.borrow_mut().pending = true;
        self.controls();
        self.status.set_text("Отправка…");
        self.queue(Command::Send(t, text));
    }
    fn attach(&self) {
        if let Some(path) = self.file(
            &self.window,
            nwg::FileDialogAction::Open,
            "Отправить документ до 10 МиБ",
        ) {
            let t = self.state.borrow().target.clone();
            self.state.borrow_mut().pending = true;
            self.controls();
            self.status.set_text("Отправляем документ…");
            self.queue(Command::Upload(t, path));
        }
    }
    fn save_file(&self) {
        let f = self
            .files
            .selection()
            .and_then(|i| self.state.borrow().attachments.get(i).cloned());
        if let Some(f) = f {
            if let Some(p) = self.file(
                &self.window,
                nwg::FileDialogAction::Save,
                &format!("Сохранить {}", f.name),
            ) {
                self.queue(Command::Download(f.id, p));
            }
        }
    }
    fn older(&self) {
        let s = self.state.borrow();
        if let Some(id) = s.timeline.older {
            self.queue(Command::History(s.target.clone(), Some(id)));
        }
    }
    fn latest(&self) {
        self.queue(Command::History(self.state.borrow().target.clone(), None));
    }
    fn reconnect(&self) {
        self.retry.set_enabled(false);
        self.status.set_text("Подключаемся…");
        self.queue(Command::Reconnect);
    }
    fn logout(&self) {
        self.queue(Command::Logout);
    }
}

pub fn run() {
    if let Err(e) = nwg::init() {
        eprintln!("{e}");
        return;
    }
    let _ = nwg::Font::set_global_family("Segoe UI");
    match App::build_ui(Default::default()) {
        Ok(app) => {
            app.start();
            nwg::dispatch_thread_events();
        }
        Err(e) => {
            nwg::error_message("Шифр-связь", &e.to_string());
        }
    }
}
