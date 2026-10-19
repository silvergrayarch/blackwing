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
            const response = await window.fetch("https://gql.twitch.tv/integrity", {
                method: "POST",
                headers: {
                    "Referer": "https://www.twitch.tv",
                    "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko",
                    "Authorization": `OAuth ${await this.get_auth_token()}`,
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "X-Device-Id": await this.get_x_device_id()
                },
            });

            if (response.status !== 200)
            {
                throw new Error(`Unexpected integrity response status ${response.status}`);
            }

            const { token, expiration } = await response.json();
            this.integrity_expiration = expiration;
            return token;
        })();

        return await this.client_integrity_token;
    }
    // async get_client_integrity_token()
    // {
    //     if (!(this.integrity_expiration < Date.now()) && this.client_integrity_token) return this.client_integrity_token;

    //     const response = await window.fetch("https://gql.twitch.tv/integrity", {
    //         method: "POST",
    //         headers: {
    //             "Origin": "https://www.twitch.tv",
    //             "Referer": "https://www.twitch.tv",
    //             "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko",
    //             "Authorization": `OAuth ${await this.get_auth_token()}`,
    //             "Content-Type": "application/json",
    //             "Accept": "application/json",
    //             "X-Device-Id": await this.get_x_device_id()
    //         },
    //     });

    //     if (response.status !== 200)
    //     {
    //         throw new Error(`Unexpected integrity response status ${response.status}`);
    //     }

    //     const { token, expiration } = await response.json();
    //     this.client_integrity_token = token;
    //     this.integrity_expiration = expiration;
    //     console.log(expiration);
    //     return this.client_integrity_token;
    // }


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