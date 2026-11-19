use crate::model::*;
use anyhow::{Context, Result, anyhow, bail, ensure};
use native_tls::TlsConnector;
use reqwest::{Client, RequestBuilder, Response, Url, header};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::json;
use std::{
    fs::File,
    io::{Read, Write},
    net::Ipv4Addr,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::{net::TcpStream, time::timeout};
use tokio_tungstenite::{
    Connector, MaybeTlsStream, WebSocketStream, connect_async_tls_with_config,
    tungstenite::{client::IntoClientRequest, protocol::WebSocketConfig},
};

const FILE_LIMIT: usize = 10 * 1024 * 1024;
pub type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

pub struct Login {
    pub address: String,
    pub nick: String,
    pub password: String,
    pub ca: Option<PathBuf>,
}

pub fn endpoint(raw: &str) -> Result<Url> {
    let raw = raw.trim();
    let explicit = raw.contains("://");
    let mut u = Url::parse(&if explicit {
        raw.into()
    } else {
        format!("https://{raw}")
    })
    .context("Введите адрес вида 192.168.1.10:8443.")?;
    ensure!(
        u.scheme() == "https"
            && u.username().is_empty()
            && u.password().is_none()
            && u.path() == "/"
            && u.query().is_none()
            && u.fragment().is_none(),
        "Нужен HTTPS-адрес без пути и параметров."
    );
    let host = u.host_str().unwrap_or_default();
    ensure!(
        host == "localhost"
            || host
                .parse::<Ipv4Addr>()
                .is_ok_and(|ip| ip.is_private() || ip.is_loopback() || ip.is_link_local()),
        "Введите IPv4-адрес сервера в локальной сети."
    );
    if !explicit && !raw.contains(':') {
        u.set_port(Some(8443))
            .map_err(|_| anyhow!("Проверьте порт."))?;
    }
    ensure!(u.port_or_known_default() != Some(0), "Проверьте порт.");
    Ok(u)
}

fn file_bytes(path: &Path, limit: usize) -> Result<Vec<u8>> {
    let file = File::open(path).context("Не удалось открыть файл.")?;
    ensure!(
        file.metadata()?.len() <= limit as u64,
        "Файл превышает допустимый размер."
    );
    let mut data = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut data)?;
    ensure!(
        !data.is_empty() && data.len() <= limit,
        "Недопустимый размер файла."
    );
    Ok(data)
}

pub struct Session {
    pub user: User,
    base: Url,
    client: Client,
    tls: TlsConnector,
    cookie: header::HeaderValue,
}

async fn checked(response: Response) -> Result<Response> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status().as_u16();
    let error = response
        .json::<serde_json::Value>()
        .await
        .unwrap_or_default();
    bail!(
        "{}",
        readable_error(error["error"].as_str().unwrap_or(&status.to_string()))
    );
}
impl Session {
    pub async fn login(login: Login) -> Result<Self> {
        let base = endpoint(&login.address)?;
        let mut tls = TlsConnector::builder();
        let mut http = Client::builder()
            .use_native_tls()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(25))
            .connect_timeout(Duration::from_secs(7));
        if let Some(p) = login.ca {
            let pem = file_bytes(&p, 64 * 1024).context("Проверьте публичный ca.crt.")?;
            tls.add_root_certificate(
                native_tls::Certificate::from_pem(&pem)
                    .context("Нужен публичный сертификат PEM.")?,
            );
            http = http.add_root_certificate(reqwest::Certificate::from_pem(&pem)?);
        }
        let tls = tls.build()?;
        let client = http.build()?;
        let response = checked(
            client
                .post(base.join("api/auth/login")?)
                .header(header::ORIGIN, base.origin().ascii_serialization())
                .json(&json!({"nickname": login.nick.trim(),"password": login.password}))
                .send()
                .await
                .context("Не удалось подключиться. Проверьте сеть, IP и доверие к ca.crt.")?,
        )
        .await?;
        let cookie = response
            .headers()
            .get_all(header::SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .filter_map(|s| s.split(';').next())
            .find(|s| s.starts_with("shifr_session=") && s.len() > "shifr_session=".len())
            .ok_or_else(|| anyhow!("Сервер не выдал сессию."))?;
        let mut cookie = header::HeaderValue::from_str(cookie)?;
        cookie.set_sensitive(true);
        #[derive(Deserialize)]
        struct Account {
            user: User,
        }
        let user = response.json::<Account>().await?.user;
        Ok(Self {
            user,
            base,
            client,
            tls,
            cookie,
        })
    }
    fn request(&self, method: reqwest::Method, path: &str) -> Result<RequestBuilder> {
        Ok(self
            .client
            .request(method, self.base.join(path)?)
            .header(header::ORIGIN, self.base.origin().ascii_serialization())
            .header(header::COOKIE, self.cookie.clone()))
    }
    async fn get_json<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> Result<T> {
        Ok(checked(
            self.request(reqwest::Method::GET, path)?
                .query(query)
                .send()
                .await?,
        )
        .await?
        .json()
        .await?)
    }
    pub async fn directory(&self) -> Result<Directory> {
        self.get_json("api/directory", &[]).await
    }
    pub async fn history(&self, target: &str, before: Option<i64>) -> Result<Page> {
        let mut q = vec![("target", target.into())];
        if let Some(id) = before {
            q.push(("before", id.to_string()));
        }
        self.get_json("api/history", &q).await
    }
    pub async fn upload(&self, target: &str, path: &Path) -> Result<Attachment> {
        let name = path
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or_else(|| anyhow!("Не удалось прочитать имя документа."))?;
        let bytes = file_bytes(path, FILE_LIMIT)?;
        let response = checked(
            self.request(reqwest::Method::POST, "api/files")?
                .query(&[("scope", "chat"), ("target", target), ("name", name)])
                .header(header::CONTENT_TYPE, "application/octet-stream")
                .body(bytes)
                .send()
                .await?,
        )
        .await?;
        #[derive(Deserialize)]
        struct Upload {
            file: Attachment,
        }
        Ok(response.json::<Upload>().await?.file)
    }
    pub async fn download(&self, id: &str, path: &Path) -> Result<()> {
        ensure!(
            id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'),
            "Неверный идентификатор файла."
        );
        let mut r = checked(
            self.request(reqwest::Method::GET, &format!("api/files/{id}"))?
                .send()
                .await?,
        )
        .await?;
        let mut temp =
            tempfile::NamedTempFile::new_in(path.parent().context("Не выбрана папка.")?)?;
        let mut total = 0;
        while let Some(chunk) = r.chunk().await? {
            total += chunk.len();
            ensure!(total <= FILE_LIMIT, "Слишком большой файл.");
            temp.write_all(&chunk)?;
        }
        ensure!(total > 0, "Пустой ответ сервера.");
        temp.flush()?;
        temp.persist(path)?;
        Ok(())
    }
    pub async fn logout(&self) -> Result<()> {
        checked(
            self.request(reqwest::Method::POST, "api/auth/logout")?
                .json(&json!({}))
                .send()
                .await?,
        )
        .await?;
        Ok(())
    }
    pub async fn socket(&self) -> Result<Socket> {
        let mut url = self.base.join("ws")?;
        url.set_scheme("wss")
            .map_err(|_| anyhow!("Не удалось сформировать WSS-адрес."))?;
        let mut req = url.as_str().into_client_request()?;
        req.headers_mut().insert(
            header::ORIGIN,
            self.base.origin().ascii_serialization().parse()?,
        );
        req.headers_mut()
            .insert(header::COOKIE, self.cookie.clone());
        let config = WebSocketConfig::default()
            .max_message_size(Some(256 * 1024))
            .max_frame_size(Some(256 * 1024));
        let result = timeout(
            Duration::from_secs(10),
            connect_async_tls_with_config(
                req,
                Some(config),
                true,
                Some(Connector::NativeTls(self.tls.clone())),
            ),
        )
        .await?;
        match result {
            Ok((socket, _)) => Ok(socket),
            Err(tokio_tungstenite::tungstenite::Error::Http(r)) if r.status().as_u16() == 409 => {
                bail!("{}", readable_error("ALREADY_CONNECTED"))
            }
            Err(tokio_tungstenite::tungstenite::Error::Http(r)) if r.status().as_u16() == 401 => {
                bail!("{}", readable_error("UNAUTHORIZED"))
            }
            Err(e) => Err(e).context("Не удалось открыть защищённый канал сообщений"),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_local_https() {
        assert_eq!(
            endpoint("192.168.1.10").unwrap().as_str(),
            "https://192.168.1.10:8443/"
        );
        assert_eq!(
            endpoint("127.0.0.1:443").unwrap().port_or_known_default(),
            Some(443)
        );
        for url in [
            "http://192.168.1.1",
            "https://example.org",
            "8.8.8.8",
            "https://user@10.1.1.1",
            "10.0.0.1/x",
        ] {
            assert!(endpoint(url).is_err());
        }
    }
}
