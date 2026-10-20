export class Twitch
{
    constructor()
    {
        this.get_login();
        this.get_auth_token();
        this.get_x_device_id();
        this.get_display_name();
        this.get_client_integrity_token();
    }

    async get_login()
    {
        if (this.login) return this.login;
        const cookie = await browser.cookies.get({ url: "https://www.twitch.tv", name: "login" });
        this.login = cookie.value;
        return this.login;
    }

    async get_auth_token()
    {
        if (this.auth_token) return this.auth_token;
        const cookie = await browser.cookies.get({ url: "https://www.twitch.tv", name: "auth-token" });
        this.auth_token = cookie.value;
        return this.auth_token;
    }


    async get_x_device_id() 
    {
        if (this.x_device_id) return this.x_device_id;
        const cookie = await browser.cookies.get({ url: "https://www.twitch.tv", name: "unique_id" });
        this.x_device_id = cookie.value;
        return this.x_device_id;
    }

    async get_client_integrity_token()
    {
        if (!(this.integrity_expiration < Date.now()) && this.client_integrity_token) return await this.client_integrity_token;

        this.integrity_expiration = Infinity;

        this.client_integrity_token = (async () =>
        {
            const current_tab = await browser.tabs.getCurrent();

            const headers = {
                "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko",
                "Authorization": `OAuth ${await this.get_auth_token()}`,
                "Content-Type": "application/json",
                "Accept": "application/json",
                "X-Device-Id": await this.get_x_device_id()
            };

            const kasada_url = "https://k.twitchcdn.net/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/p.js"

            // @SOURCE streamlink 
            // @HREF https://github.com/streamlink/streamlink/blob/master/src/streamlink/plugins/twitch.py
            // @LICENSE BSD-2-Clause 
            // @FILE licenses/streamlink-sourceline-LICENSE
            // @CREDIT Copyright (c) 2011-2016, Christopher Rosell

            const page_code = `
                document.addEventListener("kpsdk-load", () => window.KPSDK.configure([{ protocol: "https:", method: "POST", domain: "gql.twitch.tv", path: "/integrity" }]), { once: true });
                document.addEventListener("kpsdk-ready", () => fetch("https://gql.twitch.tv/integrity", { method: "POST", mode: "cors", credentials: "omit", headers: ${JSON.stringify(headers)} })
                    .then((response) => response.json())
                    .then((integrity_result) => window.postMessage({ blackwing_integrity: true, integrity_result }, "*")), { once: true });
                const kasada_script = document.createElement("script");
                kasada_script.src = "${kasada_url}";
                document.body.appendChild(kasada_script);`;

            // @END streamlink

            const frame_code = `new Promise((resolve, reject) =>
            {
                setTimeout(() => reject(new Error("Integrity token timed out")), 20000);
                window.addEventListener("message", (message_event) => { if (message_event.source === window && message_event.data?.blackwing_integrity) resolve(message_event.data.integrity_result); });
                const frame_script = document.createElement("script");
                frame_script.textContent = ${JSON.stringify(page_code)};
                document.documentElement.appendChild(frame_script);
            })`;


            const request_filter = { urls: ["https://www.twitch.tv/*"], types: ["sub_frame"], tabId: current_tab.id };

            // empty document so twitch never loads
            const swap_body = (details) =>
            {
                const response_filter = browser.webRequest.filterResponseData(details.requestId);
                response_filter.ondata = () => { };
                response_filter.onstop = () => { response_filter.write(new TextEncoder().encode("<!doctype html><title></title>")); response_filter.close(); };
            };

            // twitch refuses to be framed
            const strip_headers = (details) => ({
                responseHeaders: details.responseHeaders.filter((header) => !["x-frame-options", "content-security-policy"].includes(header.name.toLowerCase()))
            });

            const integrity_frame = document.createElement("iframe");
            integrity_frame.hidden = true;
            browser.webRequest.onBeforeRequest.addListener(swap_body, request_filter, ["blocking"]);
            browser.webRequest.onHeadersReceived.addListener(strip_headers, request_filter, ["blocking", "responseHeaders"]);

            try
            {
                await new Promise((resolve) => { integrity_frame.onload = resolve; integrity_frame.src = "https://www.twitch.tv/"; document.body.appendChild(integrity_frame); });

                const [integrity_result] = await browser.tabs.executeScript(current_tab.id, { frameId: browser.runtime.getFrameId(integrity_frame), code: frame_code });
                if (!integrity_result?.token) throw new Error("No integrity token in response");

                this.integrity_expiration = integrity_result.expiration;
                return integrity_result.token;
            }
            finally
            {
                browser.webRequest.onBeforeRequest.removeListener(swap_body);
                browser.webRequest.onHeadersReceived.removeListener(strip_headers);
                integrity_frame.remove();
            }
        })().catch((error) =>
        {
            // a failed attempt would otherwise stay cached as a rejected promise
            this.client_integrity_token = null;
            this.integrity_expiration = 0;
            throw error;
        });

        return await this.client_integrity_token;
    }


    async gql_request(operations)
    {
        const headers = {
            "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko",
            "Authorization": `OAuth ${await this.get_auth_token()}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Device-Id": await this.get_x_device_id(),
            "Client-Integrity": await this.get_client_integrity_token()
        };
        const response = await fetch("https://gql.twitch.tv/gql", { method: "POST", headers, body: JSON.stringify(operations) });
        if (!response.ok) console.error(`Error: GQL request failed, Response: ${response.status}`);

        return response.json();
    }


    async get_display_name()
    {
        if (this.display_name) return this.display_name;

        const gql_data = await this.gql_request(
            [
                {
                    operationName: "UserDisplayName",
                    query: `query UserDisplayName($login: String!) { user(login: $login, lookupType: ALL) { displayName } }`,
                    variables: { login: await this.get_login() }
                }
            ]
        );
        this.display_name = gql_data[0]?.data?.user?.displayName ?? await this.get_login();

        return this.display_name;
    }
}