use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize)]
pub struct User {
    pub nickname: String,
    pub role: String,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Channel {
    pub channel: String,
    pub name: String,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Contact {
    pub nickname: String,
}
#[derive(Debug, Deserialize)]
pub struct Directory {
    pub channels: Vec<Channel>,
    pub users: Vec<Contact>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Attachment {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Letter {
    pub id: i64,
    pub time: String,
    pub from: String,
    pub text: String,
    pub attachment: Option<Attachment>,
}
#[derive(Debug, Deserialize)]
pub struct Page {
    pub messages: Vec<Letter>,
    #[serde(rename = "nextBefore")]
    pub next: Option<i64>,
}

/// Only the open conversation keeps message bodies. Older pages are fetched on demand.
#[derive(Default)]
pub struct Timeline {
    pub messages: BTreeMap<i64, Letter>,
    pub older: Option<i64>,
    pub browsing_past: bool,
}
impl Timeline {
    pub fn live(&mut self, m: Letter) {
        if self.browsing_past {
            return;
        }
        self.messages.insert(m.id, m);
        while self.messages.len() > 100 {
            self.messages.pop_first();
            self.older = self.messages.first_key_value().map(|(id, _)| *id);
        }
    }
    pub fn page(&mut self, page: Page, before: Option<i64>) {
        if before.is_some() || self.browsing_past {
            self.messages.clear();
        }
        self.browsing_past = before.is_some();
        self.older = page.next;
        for m in page.messages {
            self.messages.insert(m.id, m);
        }
        while self.messages.len() > 100 {
            self.messages.pop_first();
            self.older = self.messages.first_key_value().map(|(id, _)| *id);
        }
    }
}

pub fn valid_text(text: &str) -> bool {
    !text.trim().is_empty() && text.len() <= 350 && !text.chars().any(|c| c.is_ascii_control())
}
pub fn readable_error(code: &str) -> String {
    match code {
        "INVALID_CREDENTIALS" => "Неверный ник или пароль.",
        "INVALID_INPUT" | "INVALID_COMMAND" => "Проверьте введённые данные.",
        "UNAUTHORIZED" => "Сессия завершилась. Войдите снова.",
        "FORBIDDEN" => "Недостаточно прав.",
        "ORIGIN_DENIED" => "Проверьте адрес сервера в ALLOWED_ORIGINS.",
        "ALREADY_CONNECTED" | "BROKER_DUPLICATE_NICK" => {
            "Аккаунт открыт на другом устройстве. Закройте другой клиент."
        }
        "BROKER_RECIPIENT_OFFLINE" => "Собеседник не в сети. Текст сохранён в поле ввода.",
        "NOT_JOINED" => "Дождитесь входа в группу.",
        "NOT_FOUND" => "Документ или чат недоступен.",
        "MESSAGE_PENDING" => "Дождитесь подтверждения предыдущего сообщения.",
        "MESSAGE_TIMEOUT" => "Сервер не подтвердил сообщение. Проверьте историю перед повтором.",
        "RATE_LIMITED" => "Слишком много запросов. Подождите немного.",
        _ => return format!("Сервер отклонил запрос ({code})."),
    }
    .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn letter(id: i64) -> Letter {
        Letter {
            id,
            from: "kate".into(),
            time: String::new(),
            text: id.to_string(),
            attachment: None,
        }
    }
    #[test]
    fn history_merges_with_live_events_and_stays_bounded() {
        let mut t = Timeline::default();
        t.live(letter(51));
        t.page(
            Page {
                messages: (1..=51).map(letter).collect(),
                next: Some(1),
            },
            None,
        );
        assert_eq!(t.messages.len(), 51);
        for i in 52..=120 {
            t.live(letter(i));
        }
        assert_eq!(t.messages.len(), 100);
        assert_eq!(t.older, Some(21));
        t.page(
            Page {
                messages: (1..21).map(letter).collect(),
                next: None,
            },
            Some(21),
        );
        t.live(letter(121));
        assert_eq!(t.messages.len(), 20);
    }
    #[test]
    fn validates_the_server_byte_limit() {
        assert!(valid_text(&"я".repeat(175)));
        assert!(!valid_text(&"я".repeat(176)));
        assert!(!valid_text("первая\nстрока"));
    }
}
