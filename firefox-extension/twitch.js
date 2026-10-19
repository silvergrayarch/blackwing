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
        if (this.client_integrity_token) return this.client_integrity_token;

        const current_tab = await browser.tabs.getCurrent();

        // @SOURCE streamlink 
        // @HREF https://github.com/streamlink/streamlink/blob/master/src/streamlink/plugins/twitch.py
        // @LICENSE BSD-2-Clause 
        // @FILE licenses/streamlink-sourceline-LICENSE
        // @CREDIT Copyright (c) 2011-2016, Christopher Rosell

        const page_code = `(() => {return new Promise((resolve, reject) =>{function configureKPSDK() { window.KPSDK.configure([{ "protocol": "https:", "method": "POST", "domain": "gql.twitch.tv", "path": "/integrity" }]); } async function fetchIntegrity(){const resp = await window.fetch("https://gql.twitch.tv/integrity", { "headers": { "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko", "Authorization": "OAuth ${await this.get_auth_token()}", "Content-Type": "application/json", "Accept": "application/json", "X-Device-Id": "${await this.get_x_device_id()}" }, "body": null, "method": "POST", "mode": "cors", "credentials": "omit" }); if (resp.status !== 200){throw new Error(\`Unexpected integrity response status code \${resp.status}\`);} return JSON.stringify(await resp.json());} document.addEventListener("kpsdk-load", configureKPSDK, { once: true }); document.addEventListener("kpsdk-ready", () => fetchIntegrity().then(resolve, reject), { once: true }); const script = document.createElement("script"); script.addEventListener("error", reject); script.src = "https://k.twitchcdn.net/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/p.js"; document.body.appendChild(script);});}) ().then((token) => window.postMessage({ blackwing_integrity: true, token }, "*"), (error) => window.postMessage({ blackwing_integrity: true, error: String(error) }, "*"));`;

        // @END streamlink

        const frame_code = `new Promise((resolve, reject) =>
        {
            const timeout_id = setTimeout(() => reject(new Error("Integrity token timed out")), 20000);

            window.addEventListener("message", (event) =>
            {
                if (event.source !== window || !event.data?.blackwing_integrity) return;
                clearTimeout(timeout_id);
                if (event.data.error) reject(new Error(event.data.error));
                else resolve(event.data.token);
            });

            const script = document.createElement("script");
            script.textContent = ${JSON.stringify(page_code)};
            document.documentElement.appendChild(script);
        })`;

        const request_filter = { urls: ["https://www.twitch.tv/*"], types: ["sub_frame"], tabId: current_tab.id };

        // replace the page with an empty document so Twitch's app never loads
        function swap_body_for_empty_document(details)
        {
            const response_filter = browser.webRequest.filterResponseData(details.requestId);
            response_filter.ondata = () => { };
            response_filter.onstop = () =>
            {
                response_filter.write(new TextEncoder().encode("<!doctype html><html><head></head><body></body></html>"));
                response_filter.close();
            };
        }

        // twitch refuses to be framed, so strip the headers that block it
        function strip_frame_blocking_headers(details)
        {
            return {
                responseHeaders: details.responseHeaders.filter((header) =>
                    !["x-frame-options", "content-security-policy"].includes(header.name.toLowerCase()))
            };
        }

        browser.webRequest.onBeforeRequest.addListener(swap_body_for_empty_document, request_filter, ["blocking"]);
        browser.webRequest.onHeadersReceived.addListener(strip_frame_blocking_headers, request_filter, ["blocking", "responseHeaders"]);

        const integrity_frame = document.createElement("iframe");
        integrity_frame.style.display = "none";


        await new Promise((resolve, reject) =>
        {
            integrity_frame.addEventListener("load", resolve, { once: true });
            integrity_frame.addEventListener("error", reject, { once: true });
            integrity_frame.src = "https://www.twitch.tv/";
            document.body.appendChild(integrity_frame);
        });

        const all_frames = await browser.webNavigation.getAllFrames({ tabId: current_tab.id });
        const twitch_frame = all_frames.find((frame) => frame.url.startsWith("https://www.twitch.tv/"));
        if (!twitch_frame) throw new Error("Twitch integrity frame not found");
        this.client_integrity_token = JSON.parse((await browser.tabs.executeScript(current_tab.id, { frameId: twitch_frame.frameId, code: frame_code }))[0]).token;
        browser.webRequest.onBeforeRequest.removeListener(swap_body_for_empty_document);
        browser.webRequest.onHeadersReceived.removeListener(strip_frame_blocking_headers);

        integrity_frame.remove();
        return this.client_integrity_token;
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