document.addEventListener("DOMContentLoaded", async () => init());

let auth_token = null;
let x_device_id = null;
let client_integrity_token = null;

const follower_count_cache = new Map();
const channel_text_cache = new Map();
const cards_per_load = 10;
let category_nodes = [];
let category_states = new Map();

let current_page = "home-page";

async function init()
{
    // const test_element = document.getElementById("test");

    // const ops = [


    // ];
    // const gql_data = await gql_request(ops);

    // test_element.textContent = JSON.stringify(gql_data);
    document.getElementById("home-page-button").addEventListener("click", () => { swap_page("home-page"); });
    document.getElementById("following-page-button").addEventListener("click", () => { swap_page("following-page"); });
    document.getElementById("recommended-page-button").addEventListener("click", () => { swap_page("recommended-page"); });
    document.getElementById("settings-menu-button").addEventListener("click", toggle_settings_menu);
    document.getElementById("load-more-recommended").addEventListener("click", get_recommended_channels);

    bind_input("filter-tags");
    bind_input("bad-tags");
    bind_input("bad-title-keywords");
    bind_input("bad-description-keywords");
    bind_input("bad-pannel-keywords");
    bind_input("bad-rule-keywords");
    bind_input("max-viewers");
    bind_input("max-followers");
    bind_input("min-viewers");
    bind_input("min-followers");

    await get_recommended_channels();
    await get_live_followed_channels();

    window.setInterval(refresh_followed_channels, 90000);
    window.setInterval(refresh_recommended_channels, 90000);
}

function bind_input(input_element_id)
{
    const input_element = document.getElementById(input_element_id);
    const storage_key = input_element_id.replaceAll("-", "_");

    browser.storage.local.get(storage_key).then((stored_values) => { input_element.value = stored_values[storage_key] ?? input_element.value; });
    input_element.addEventListener("input", (event) => { browser.storage.local.set({ [storage_key]: event.target.value }); });
}

function swap_page(page_str)
{
    if (current_page === page_str) return;
    document.getElementById(current_page).hidden = true;
    document.getElementById(page_str).hidden = false;
    current_page = page_str;

    if (current_page === "following-page")
        refresh_followed_channels();
    else if (current_page === "recommended-page")
        refresh_recommended_channels();
}

function toggle_settings_menu()
{
    const active_page = document.getElementById(current_page);
    const settings_page = document.getElementById("settings-menu");
    active_page.hidden = !active_page.hidden;
    settings_page.hidden = !settings_page.hidden;
}

async function get_auth_token()
{
    if (auth_token) return auth_token;
    const cookie = await browser.cookies.get(
        {
            url: "https://www.twitch.tv",
            name: "auth-token"
        }
    );

    auth_token = cookie ? cookie.value : null;
    return auth_token;
}

async function get_x_device_id() 
{
    if (x_device_id) return x_device_id;
    const cookie = await browser.cookies.get(
        {
            url: "https://www.twitch.tv",
            name: "unique_id"
        }
    );

    x_device_id = cookie ? cookie.value : null;
    return x_device_id;
}

function get_client_integrity_token(request_headers)
{
    if (client_integrity_token) return client_integrity_token;

    client_integrity_token = (async () =>
    {
        const device_id = await get_x_device_id();
        const current_tab = await browser.tabs.getCurrent();

        function integrity_promise_in_page(request_headers, device_id)
        {
            return new Promise((resolve, reject) =>
            {
                function configureKasadaSdk()
                {
                    window.KPSDK.configure(
                        [
                            {
                                protocol: "https:",
                                method: "POST",
                                domain: "gql.twitch.tv",
                                path: "/integrity",
                            },
                        ]
                    );
                }

                async function fetchIntegrityResponse()
                {
                    const response = await window.fetch("https://gql.twitch.tv/integrity", {
                        method: "POST",
                        mode: "cors",
                        credentials: "omit",
                        body: null,
                        headers: { ...request_headers, "x-device-id": device_id },
                    });

                    if (response.status !== 200)
                    {
                        throw new Error(`Unexpected integrity response status ${response.status}`);
                    }

                    const { token } = await response.json();
                    return token;
                }

                document.addEventListener("kpsdk-load", configureKasadaSdk, { once: true });
                document.addEventListener("kpsdk-ready", () => fetchIntegrityResponse().then(resolve, reject), { once: true });

                const kasada = document.createElement("script");
                kasada.addEventListener("error", reject);
                kasada.src = "https://k.twitchcdn.net/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/p.js";
                document.body.appendChild(kasada);
            });
        }

        // runs promise in the page's own JS world and posts the result back
        const page_code = `(${integrity_promise_in_page.toString()})(${JSON.stringify(request_headers)}, ${JSON.stringify(device_id)}).then(
            (token) => window.postMessage({ blackwing_integrity: true, token }, "*"),
            (error) => window.postMessage({ blackwing_integrity: true, error: String(error) }, "*")
        );`;

        // runs in the frame's content script world, injects page_code, and waits for the postMessage
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

            const page_script = document.createElement("script");
            page_script.textContent = ${JSON.stringify(page_code)};
            document.documentElement.appendChild(page_script);
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

        try
        {
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

            const [token] = await browser.tabs.executeScript(current_tab.id, { frameId: twitch_frame.frameId, code: frame_code });
            return token;
        }
        catch (error)
        {
            client_integrity_token = null; // so the next call retries
            throw error;
        }
        finally
        {
            browser.webRequest.onBeforeRequest.removeListener(swap_body_for_empty_document);
            browser.webRequest.onHeadersReceived.removeListener(strip_frame_blocking_headers);
            integrity_frame.remove();
        }
    })();

    return client_integrity_token;
}

async function gql_request(operations)
{
    const token = await get_auth_token();
    if (!token)
    {
        throw new Error("Not logged into Twitch. No auth-token cookie found.");
    }

    const headers = {
        "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko",
        "Authorization": `OAuth ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
    };

    headers["Client-Integrity"] = await get_client_integrity_token(headers);
    headers["X-Device-Id"] = await get_x_device_id();

    const response = await fetch("https://gql.twitch.tv/gql", {
        method: "POST",
        headers,
        body: JSON.stringify(operations)
    });

    if (!response.ok) throw new Error(`GQL request failed: ${response.status}`);
    return response.json();
}

function build_cards(parent, edges)
{
    for (const edge of edges)
    {
        const node = edge.node;
        const stream_card = document.createElement("div");
        stream_card.className = "stream-card";

        const preview_image_wrapper = document.createElement("div");
        preview_image_wrapper.className = "preview-image";

        const preview_image = document.createElement("img");
        const preview_url = node.stream.previewImageURL;
        preview_image.src = preview_url;

        preview_image_wrapper.appendChild(preview_image);
        stream_card.appendChild(preview_image_wrapper);

        const profile_image_wrapper = document.createElement("div");
        profile_image_wrapper.className = "profile-image"

        const profile_image = document.createElement("img");
        profile_image.src = node.profileImageURL;

        profile_image_wrapper.appendChild(profile_image);
        stream_card.appendChild(profile_image_wrapper);

        const title = document.createElement("div");
        title.className = "title";

        title.textContent = node.stream.title;
        stream_card.appendChild(title);

        const username = document.createElement("div");
        username.className = "username";

        username.textContent = node.displayName;
        stream_card.appendChild(username);

        const category = document.createElement("div");
        category.className = "category";

        category.textContent = node.stream.game.displayName;
        stream_card.appendChild(category);

        const tags = document.createElement("div");
        tags.className = "tags";

        for (const freeform_tag of node.stream.freeformTags)
        {
            const tag = document.createElement("div");
            tag.className = "tag";

            tag.textContent = freeform_tag.name;
            tags.appendChild(tag);
        }

        stream_card.appendChild(tags);

        const open = document.createElement("a");
        open.className = "open";
        open.href = `https://www.twitch.tv/${node.login}`;
        open.textContent = "Open Stream";

        stream_card.appendChild(open);

        parent.appendChild(stream_card);
    }
}

async function get_live_followed_channels()
{

    const followed_live_channels = document.getElementById("live-followed-channels");

    const operations = [
        {
            extensions: {
                persistedQuery: {
                    sha256Hash: "bbfa83064e90280dce3eaa9de3a18eb6647505546336313241afdf569b6b34b6",
                    version: 1
                }
            },
            operationName: "FollowingLive_CurrentUser",
            variables: {
                imageWidth: 50,
                includeCostreaming: true,
                limit: 100
            }
        }
    ];
    const gql_data = await gql_request(operations);
    const edges = gql_data[0].data.currentUser.followedLiveUsers.edges;

    build_cards(followed_live_channels, edges);
}

function game_query(slug, cursor = undefined)
{
    return {
        extensions: {
            persistedQuery: {
                sha256Hash: "86bcceb4e8b1a51256ff8eed8bd8aae4acacf80d737efe904f84f3aeadf8cafd",
                version: 1
            }
        },
        operationName: "DirectoryPage_Game",
        variables: {
            cursor,
            imageWidth: 50,
            includeCostreaming: true,
            limit: 100,
            options: {
                broadcasterLanguages: [
                    "EN"
                ],
                freeformTags: null,
                includeRestricted: [
                    "SUB_ONLY_LIVE"
                ],
                recommendationsContext: {
                    platform: "web"
                },
                requestID: "JIRA-VXP-2397",
                sort: "VIEWER_COUNT_ASC",
                systemFilters: [],
                tags: []
            },
            slug,
            sortTypeIsRecency: false
        }
    };
}

//PYTHON def parse_csv_set(value: str) -> set: return {x.strip().lower() for x in value.split(",") if x.strip()}
// filter(Boolean) matters: "".split(",") gives [""], and every string "includes" an empty keyword
function parse_keywords(value)
{
    return (value ?? "").split(",").map(keyword => keyword.trim().toLowerCase()).filter(Boolean);
}

function parse_count(value)
{
    const trimmed_value = String(value ?? "").trim();
    return /^\d+$/.test(trimmed_value) ? Number(trimmed_value) : null;
}

async function load_filters()
{
    const stored_settings = await browser.storage.local.get(
        [
            "filter_tags", "bad_tags",
            "bad_title_keywords", "bad_description_keywords",
            "bad_pannel_keywords", "bad_rule_keywords",
            "max_viewers", "max_followers",
            "min_viewers", "min_followers"
        ]
    );

    return {
        tag_expression: (stored_settings.filter_tags ?? "").trim().toLowerCase(),
        bad_tag_expression: (stored_settings.bad_tags ?? "").trim().toLowerCase(),
        bad_title_keywords: parse_keywords(stored_settings.bad_title_keywords),
        bad_description_keywords: parse_keywords(stored_settings.bad_description_keywords),
        bad_panel_keywords: parse_keywords(stored_settings.bad_pannel_keywords),
        bad_rule_keywords: parse_keywords(stored_settings.bad_rule_keywords),
        max_viewers: parse_count(stored_settings.max_viewers),
        max_followers: parse_count(stored_settings.max_followers),
        min_viewers: parse_count(stored_settings.min_viewers),
        min_followers: parse_count(stored_settings.min_followers)
    };
}

function get_follower_count(user_id)
{
    if (follower_count_cache.has(user_id)) return follower_count_cache.get(user_id);

    const follower_count = (async () =>
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
    })();

    follower_count_cache.set(user_id, follower_count);
    follower_count.catch(() => follower_count_cache.delete(user_id)); // don't cache failures
    return follower_count;
}

function get_channel_text_parts(login)
{
    if (channel_text_cache.has(login)) return channel_text_cache.get(login);

    const channel_text_parts = (async () =>
    {
        const operations = [
            {
                operationName: "ChannelDescription",
                query: `query ChannelDescription($login: String!) { user(login: $login) { description } }`,
                variables: { login }
            },
            {
                operationName: "ChannelPanels",
                query: `query ChannelPanels($login: String!) { user(login: $login) { panels { type ... on DefaultPanel { description } } } }`,
                variables: { login }
            },
            {
                operationName: "Chat_ChatRules",
                query: `query Chat_ChatRules($login: String!) { user(login: $login) { chatSettings { rules } } }`,
                variables: { login }
            }
        ];
        const twitch_response = await gql_request(operations);

        return {
            description: (twitch_response[0]?.data?.user?.description ?? "").toLowerCase(),
            panels: (twitch_response[1]?.data?.user?.panels ?? []).map(panel => panel.description ?? "").join(" ").toLowerCase(),
            rules: (twitch_response[2]?.data?.user?.chatSettings?.rules ?? []).join(" ").toLowerCase()
        };
    })();

    channel_text_cache.set(login, channel_text_parts);
    return channel_text_parts;
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

// true/false if the expression is valid, null if it isn't (so a typo in the settings box doesn't filter everything out)
function matches_tag_expression(expression, tags)
{
    try { return has_good_tags(expression, tags); }
    catch (error) { console.error("Bad tag expression:", expression, error.message); return null; }
}

// cheap checks first, so the extra requests only happen for streams that already passed them
async function stream_passes_filters(stream, filters)
{
    if (filters.min_viewers !== null && stream.viewersCount < filters.min_viewers) return false;
    if (filters.max_viewers !== null && stream.viewersCount > filters.max_viewers) return false;

    const stream_tags = stream.freeformTags.map(tag => tag.name.toLowerCase());

    if (filters.tag_expression && matches_tag_expression(filters.tag_expression, stream_tags) === false) return false;
    if (filters.bad_tag_expression && matches_tag_expression(filters.bad_tag_expression, stream_tags) === true) return false;

    const stream_title = (stream.title ?? "").toLowerCase();
    if (filters.bad_title_keywords.some(keyword => stream_title.includes(keyword))) return false;

    if (filters.min_followers !== null || filters.max_followers !== null)
    {
        const follower_count = await get_follower_count(stream.broadcaster.id);
        if (filters.min_followers !== null && follower_count < filters.min_followers) return false;
        if (filters.max_followers !== null && follower_count > filters.max_followers) return false;
    }

    const needs_channel_text = filters.bad_description_keywords.length > 0
        || filters.bad_panel_keywords.length > 0
        || filters.bad_rule_keywords.length > 0;

    if (needs_channel_text)
    {
        const channel_text_parts = await get_channel_text_parts(stream.broadcaster.login);
        if (filters.bad_description_keywords.some(keyword => channel_text_parts.description.includes(keyword))) return false;
        if (filters.bad_panel_keywords.some(keyword => channel_text_parts.panels.includes(keyword))) return false;
        if (filters.bad_rule_keywords.some(keyword => channel_text_parts.rules.includes(keyword))) return false;
    }

    return true;
}

async function get_category_nodes()
{
    const gql_data = await gql_request(
        [
            {
                extensions: {
                    persistedQuery: {
                        sha256Hash: "f3c5d45175d623ed3d5ff4ca4c7de379ea6a1a4852236087dc1b81b7dbfd3114",
                        version: 1
                    }
                },
                operationName: "FollowingGames_CurrentUser",
                variables: {
                    limit: 30,
                    type: "LIVE"
                }
            },
        ]
    );

    category_nodes = gql_data[0].data.currentUser.followedGames.nodes;

    for (const node of category_nodes)
        category_states.set(node.slug, { cursor: undefined, finished: false, seen: new Set() });
}

async function get_recommended_channels()
{
    const load_more_button = document.getElementById("load-more-recommended");

    if (load_more_button.disabled) return;
    load_more_button.disabled = true;

    const recommended_channels = document.getElementById("recommended-channels");

    try
    {
        if (category_nodes.length === 0)
            await get_category_nodes();

        const filters = await load_filters();

        let cards_added = 0;
        while (cards_added < cards_per_load)
        {
            const unfinished_nodes = category_nodes.filter(node => !category_states.get(node.slug).finished);
            if (unfinished_nodes.length === 0)
                break;

            for (const node of unfinished_nodes)
            {
                // await new Promise(r => setTimeout(r, 250));
                const state = category_states.get(node.slug);

                const response = await gql_request(game_query(node.slug, state.cursor));

                const streams = response?.data?.game?.streams;

                if (!streams || streams.edges.length === 0)
                {
                    console.warn("finished: ", node.slug, ", reason: empty or missing response, errors: ", response?.errors ?? "");
                    state.finished = true;
                    continue;
                }

                let new_streams = 0;
                for (const edge of streams.edges)
                {
                    const username = edge.node.broadcaster.login;

                    if (state.seen.has(username)) continue;
                    state.seen.add(username);

                    new_streams++;

                    // skip streams that fail any of the filters
                    if (!(await stream_passes_filters(edge.node, filters)))
                        continue;

                    build_cards(recommended_channels, [
                        {
                            node: {
                                profileImageURL: edge.node.broadcaster.profileImageURL,
                                displayName: edge.node.broadcaster.displayName,
                                login: username,
                                stream: edge.node
                            }
                        }
                    ]);
                    cards_added++;
                }

                if (new_streams === 0)
                    state.finished = true;

                const last_stream = streams.edges[streams.edges.length - 1];

                state.cursor = last_stream.cursor;

                const past_max_viewers = filters.max_viewers !== null && last_stream.node.viewersCount > filters.max_viewers;

                if (past_max_viewers || !streams.pageInfo.hasNextPage)
                    state.finished = true;

                if (cards_added >= cards_per_load)
                    break;
            }
        }
    }
    catch (error)
    {
        console.error("Failed to load recommended channels:", error);
    }
    finally
    {
        load_more_button.disabled = false;

        // when every game has been fully exhausted hide the Load More button
        load_more_button.hidden = category_nodes.length > 0 && category_nodes.every(node => category_states.get(node.slug).finished);
    }
}

async function refresh_followed_channels() 
{
    if (document.getElementById("following-page").hidden) return;
    const cards = document.querySelectorAll("#following-page .stream-card");

    const operations = [];

    for (const card of cards)
    {
        operations.push(
            {
                "extensions": {
                    "persistedQuery": {
                        "sha256Hash": "ad022ca32220d5523d03a23cbcb5beaa1e0999889c1f8f78f9f2520dafb5cae6",
                        "version": 1
                    }
                },
                "operationName": "StreamMetadata",
                "variables": {
                    "channelLogin": card.querySelectorAll(".username")[0].textContent.toLowerCase()
                }
            }
        )

    }

    const gql_data = await gql_request(operations);

    for (var i = 0; i < cards.length; ++i)
    {
        if (!gql_data[i].data?.user?.stream?.type || gql_data[i].data?.user?.stream?.type == null)
            cards[i].remove();
        else
        {
            const preview_image = cards[i].querySelectorAll(".profile-image img")[0];
            preview_image.src = preview_image.src;
        }
    }
}


async function refresh_recommended_channels()
{
    if (document.getElementById("recommended-page").hidden) return;
    document.getElementById("recommended-channels").innerHTML = "";
    await get_recommended_channels();
}