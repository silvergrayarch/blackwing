document.addEventListener("DOMContentLoaded", async () => init());

let auth_token = null;

async function init()
{
    await load_filters();
    const results = await load_results();
    if (Object.keys(results).length > 0) 
    {
        render_streams(results, document.getElementById("results"));
    }
    document.getElementById("run_button").addEventListener("click", run);
}

async function get_auth_token()
{
    if (auth_token) return auth_token;
    const cookie = await browser.cookies.get({
        url: "https://www.twitch.tv",
        name: "auth-token"
    });

    auth_token = cookie ? cookie.value : null;
    return auth_token;
}

async function gql_request(operations)
{
    const token = await get_auth_token();
    if (!token)
    {
        throw new Error("Not logged into Twitch. No auth-token cookie found.");
    }

    const response = await fetch("https://gql.twitch.tv/gql", {
        method: "POST",
        headers: {
            "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko",
            "Authorization": `OAuth ${token}`,
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: JSON.stringify({ operations })
    });

    if (!response.ok) throw new Error(`GQL request failed: ${response.status}`);
    return response.json();
}

//PYTHON def join_set(s: set | None) -> str: return ", ".join(sorted(s)) if s else ""
function join_set(set) { return (!Array.isArray(set) || set.length === 0) ? "" : [...new Set(set)].sort().join(", "); }

//PYTHON def parse_csv_set(value: str) -> set: return {x.strip().lower() for x in value.split(",") if x.strip()}
function parse_csv(csv) { return [...new Set(csv.split(",").map(value => value.trim().toLowerCase()))]; }

async function save_filters(filters) { await browser.storage.local.set({ filters }); }

async function load_filters()
{
    const stored = await browser.storage.local.get("filters");
    const filters = stored.filters ?? {};

    document.getElementById("categories").value = join_set(filters.categories);
    document.getElementById("filter_tags").value = filters.filter_tags ?? "";
    document.getElementById("bad_keywords").value = join_set(filters.bad_keywords);
    document.getElementById("max_viewers").value = filters.max_viewers ?? "";
    document.getElementById("max_followers").value = filters.max_followers ?? "";
}

async function save_results(streams)
{
    await browser.storage.local.set({ results: streams });
}

async function load_results()
{
    const stored = await browser.storage.local.get("results");
    return stored.results ?? {};
}

function get_filters()
{
    const max_viewers = document.getElementById("max_viewers").value.trim();
    const max_followers = document.getElementById("max_followers").value.trim();

    return {
        categories: parse_csv(document.getElementById("categories").value),
        filter_tags: document.getElementById("filter_tags").value.trim() || null,
        bad_keywords: parse_csv(document.getElementById("bad_keywords").value),
        max_viewers: /^\d+$/.test(max_viewers) ? Number(max_viewers) : null,
        max_followers: /^\d+$/.test(max_followers) ? Number(max_followers) : null
    };
}

function evaluate_boolean_expression(expression)
{
    let tokens = expression.match(/\(|\)|&&|\|\||true|false/g); // splits the expression string into an array of tokens (parenthesis, &&, ||, true, false) for the parser to walk
    let pos = 0;

    function parse_or()
    {
        let left = parse_and();
        while (tokens[pos] === "||") { pos++; left = left || parse_and(); }
        return left;
    }

    function parse_and()
    {
        let left = parse_value();
        while (tokens[pos] === "&&") { pos++; left = left && parse_value(); }
        return left;
    }

    function parse_value()
    {
        if (tokens[pos] === "(") { pos++; const result = parse_or(); pos++; return result; }
        const value = tokens[pos] === "true";
        pos++;
        return value;
    }

    return parse_or();
}

// if there is anything but whitespaces, parenthesis, or letters it throws an error
// for each tag it replaces occurrences of that tag (escaping any parenthesis) in the expression with "true"
// then replaces remaining untagged values with "false" then converts and/or into JS operators (&&/||)
function has_good_tags(expression, tags)
{
    if (!/^[\w\s()]+$/.test(expression)) throw new Error("Invalid Tag Expression");
    for (const tag of tags) expression = expression.replace(new RegExp(`\\b${tag.replace(/[()]/g, "\\$&")}\\b`, "g"), "true");
    expression = expression.replace(/\b(?!true\b|and\b|or\b)\w+\b/g, "false").replace(/\band\b/g, "&&").replace(/\bor\b/g, "||");
    return evaluate_boolean_expression(expression);
}

function has_bad_tags(keywords, tags) { return tags.some(tag => keywords.some(keyword => tag.includes(keyword))); }
// function has_bad_username(keywords, username) { return keywords.some(keyword => username.includes(keyword)); }

async function get_follower_count(user_id)
{
    const operations = [
        {
            operationName: "ChannelFollowerCount",
            query: `query ChannelFollowerCount($id: ID!) { user(id: $id) { followers { totalCount } } }`,
            variables: { "id": user_id }
        }
    ];
    const twitch_response = await gql_request(operations);
    return twitch_response[0]?.data?.user?.followers?.totalCount ?? 0;
}

async function get_channel_text(username)
{
    const operations = [
        {
            operationName: "ChannelDescription",
            query: `query ChannelDescription($login: String!) { user(login: $login) { description } }`,
            variables: { "login": username }
        },
        {
            operationName: "ChannelPanels",
            query: `query ChannelPanels($login: String!) { user(login: $login) { panels { type ... on DefaultPanel { description } } } }`,
            variables: { "login": username }
        },
        {
            operationName: "Chat_ChatRules",
            query: `query Chat_ChatRules($login: String!) { user(login: $login) { chatSettings { rules } } }`,
            variables: { "login": username }
        }
    ];
    const twitch_response = await gql_request(operations);

    const description = twitch_response[0]?.data?.user?.description ?? "";
    const panels = (twitch_response[1]?.data?.user?.panels ?? []).map(p => p.description ?? "");
    const rules = twitch_response[2]?.data?.user?.chatSettings?.rules ?? [];
    return [description, ...panels, ...rules].join(" ");
}


async function process_card(card, filters)
{
    try
    {
        const tags = [...card.querySelectorAll(".channel-card-tags a")].map(tag => tag.textContent.toLowerCase());
        if (filters.filter_tags && !has_good_tags(filters.filter_tags, tags)) { return null; }
        if (has_bad_tags(filters.bad_keywords, tags)) { return null; }

        const username_elem = card.querySelector(".channel-card-username a");
        const link = username_elem.getAttribute("href");
        const username = link.split("/").pop();
        // if (has_bad_username(filters.bad_keywords, username)) { return null; }

        const channel_id_elem = card.querySelector(".channel-card-channel_id");
        const user_id = channel_id_elem.textContent.replace("Channel ID:", "").trim();

        const viewers_text = card.querySelector(".channel-card-viewers").textContent.replace("Viewers:", "").trim();
        const viewers = parseInt(viewers_text.replace(/,/g, ""), 10);
        if (filters.max_viewers && viewers > filters.max_viewers) { return null; }

        const followers = await get_follower_count(user_id);
        if (filters.max_followers && followers > filters.max_followers) { return null; }

        const title_elem = card.querySelector(".card-title a");
        const title_text = title_elem ? title_elem.textContent.trim() : "";
        const title_words = new Set(title_text.toLowerCase().split(/[^a-z0-9]+/));
        const bad_title = filters.bad_keywords.some(keyword => title_words.has(keyword.toLowerCase()));
        if (bad_title) { return null; }

        const channel_text = await get_channel_text(username);
        const channel_words = new Set(channel_text.toLowerCase().split(/[^a-z0-9]+/));
        if (filters.bad_keywords.some(keyword => channel_words.has(keyword.toLowerCase()))) { return null; }

        return { id: user_id, username, title: title_text, followers, viewers, tags, link };
    }
    catch (e) { throw e; }
}

async function fetch_streams(category, filters)
{
    const streams = {};
    let current_page = 1;
    while (true)
    {
        const params = new URLSearchParams({ "broadcaster_languages[]": "EN", "page": current_page });

        if (filters.max_viewers) { params.append("viewers_max", filters.max_viewers); }
        if (category) { params.append("games[]", category); }

        const response = await fetch(`https://twitch-tools.rootonline.de/channel_previews.php?${params.toString()}`,
            {
                headers:
                {
                    "user-agent": "Mozilla/5.0",
                    "accept-language": "en-US,en;q=0.9"
                }
            }
        );

        const response_text = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(response_text, "text/html");
        const cards = [...doc.querySelectorAll("div.card-block")];

        if (cards.length === 0) { break; }

        const card_promises = cards.map(card => process_card(card, filters));
        const results = await Promise.all(card_promises);

        for (const result of results) 
        {
            if (result) 
            {
                result.category = category;
                streams[result.id] = result;
            }
        }

        current_page++;
    }

    return streams;
}

async function run()
{
    const run_button = document.getElementById("run_button");
    run_button.disabled = true;

    try
    {
        const filters = get_filters();
        await save_filters(filters);

        const results_container = document.getElementById("results");
        results_container.innerHTML = "";

        let all_streams = {};

        for (const category of filters.categories) 
        {
            const streams = await fetch_streams(category, filters);
            all_streams = { ...all_streams, ...streams };
        }

        await save_results(all_streams);
        render_streams(all_streams, results_container);
    }
    finally { run_button.disabled = false; }
}

function render_streams(streams, container)
{
    container.innerHTML = "";

    for (const stream of Object.values(streams))
    {
        const card = document.createElement("div");
        card.className = "stream-card";

        const tags_html = stream.tags.map(tag => `<div class="tag">${tag}</div>`).join("");

        card.innerHTML = `
        <div class="category">${stream.category}</div>
        <div class="title">${stream.title}</div>
        <div class="username">${stream.username}</div>
        <div class="stats">Viewers: ${stream.viewers.toLocaleString()}</div>
        <div class="stats">Followers: ${stream.followers.toLocaleString()}</div>
        <div class="tags">${tags_html}</div>
        <a class="open" href="${stream.link}" target="_blank" rel="noopener noreferrer">Open stream</a>
        `;

        container.appendChild(card);
    }
}

// function escape_html(str) {
//     const div = document.createElement("div");
//     div.textContent = str;
//     return div.innerHTML;
// }
