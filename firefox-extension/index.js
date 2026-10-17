document.addEventListener("DOMContentLoaded", async () => init());

const user_context = {
    login: null,
    display_name: null,
    auth_token: null,
    x_device_id: null,
    client_integrity_token: null
};

const blackwing_context = {
    cards_per_load: 10,
    current_page: "following-page",

    category_nodes: [],
    category_states: new Map(),

    profile_image_cache: new Map(),

    chat_connection: null,
    chat_disconnect_element: document.getElementById("watching-page")
};

let client_integrity_token = null;

async function init()
{
    // const test_element = document.getElementById("test");

    // const ops = [


    // ];
    // const gql_data = await gql_request(ops);

    // test_element.textContent = JSON.stringify(gql_data);

    document.getElementById("following-page-button").addEventListener("click", () => { swap_page("following-page"); });
    document.getElementById("recommended-page-button").addEventListener("click", () => { swap_page("recommended-page"); });
    document.getElementById("settings-menu-button").addEventListener("click", toggle_settings_menu);
    document.getElementById("load-more-recommended").addEventListener("click", get_recommended_channels);
    document.getElementById("send-button").addEventListener("click", () => send_chat(blackwing_context.chat_connection));
    document.getElementById("chat-input").addEventListener("keydown", (keyboard_event) => { if (keyboard_event.key === "Enter" && !keyboard_event.shiftKey) send_chat(blackwing_context.chat_connection); });

    // blackwing_context.chat_connection = await open_chat_connection(
    //     "silver_grayy",
    //     {
    //         on_chat_message: (chat_message) => render_message(chat_message.login, chat_message.display_name, chat_message.message_text),
    //         on_notice: (notice_id, notice_text) => console.warn(notice_id, notice_text),
    //         on_close: (error) => console.log("chat closed", error?.message ?? "")
    //     }
    // );

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

    get_followed_channels();
    get_recommended_channels();


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
    if (blackwing_context.current_page === page_str) return;
    document.getElementById(blackwing_context.current_page).hidden = true;
    document.getElementById(page_str).hidden = false;
    blackwing_context.current_page = page_str;

    if (blackwing_context.current_page === "following-page")
        refresh_followed_channels();
    else if (blackwing_context.current_page === "recommended-page")
        refresh_recommended_channels();
}

function toggle_settings_menu()
{
    const active_page = document.getElementById(blackwing_context.current_page);
    const settings_page = document.getElementById("settings-menu");
    active_page.hidden = !active_page.hidden;
    settings_page.hidden = !settings_page.hidden;
}

async function get_twitch_cookie(name)
{
    const cookie = await browser.cookies.get(
        {
            url: "https://www.twitch.tv",
            name
        }
    );

    return cookie ? cookie.value : null;
}

async function get_user_login() 
{
    if (user_context.login) return user_context.login;
    user_context.login = await get_twitch_cookie("login")
    return user_context.login;
}

async function get_auth_token()
{
    if (user_context.auth_token) return user_context.auth_token;
    user_context.auth_token = await get_twitch_cookie("auth-token")
    return user_context.auth_token;
}

async function get_x_device_id() 
{
    if (user_context.x_device_id) return user_context.x_device_id;
    user_context.x_device_id = await get_twitch_cookie("unique_id")
    return user_context.x_device_id;
}

async function get_client_integrity_token(headers)
{
    if (user_context.client_integrity_token) return user_context.client_integrity_token;

    const current_tab = await browser.tabs.getCurrent();

    function integrity_promise_in_page(headers)
    {
        return new Promise((resolve, reject) =>
        {
            function configure_kasada_sdk()
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

            async function fetch_integrity_response()
            {
                const response = await window.fetch("https://gql.twitch.tv/integrity", {
                    method: "POST",
                    mode: "cors",
                    credentials: "omit",
                    body: null,
                    headers,
                });

                if (response.status !== 200)
                {
                    throw new Error(`Unexpected integrity response status ${response.status}`);
                }

                const { token } = await response.json();
                return token;
            }

            document.addEventListener("kpsdk-load", configure_kasada_sdk, { once: true });
            document.addEventListener("kpsdk-ready", () => fetch_integrity_response().then(resolve, reject), { once: true });

            const kasada = document.createElement("script");
            kasada.addEventListener("error", reject);
            kasada.src = "https://k.twitchcdn.net/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/p.js";
            document.body.appendChild(kasada);
        });
    }

    // runs promise in the page's own JS world and posts the result back
    const page_code = `(${integrity_promise_in_page.toString()})(${JSON.stringify(headers)}).then(
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

    user_context.client_integrity_token = (await browser.tabs.executeScript(current_tab.id, { frameId: twitch_frame.frameId, code: frame_code }))[0];
    browser.webRequest.onBeforeRequest.removeListener(swap_body_for_empty_document);
    browser.webRequest.onHeadersReceived.removeListener(strip_frame_blocking_headers);

    integrity_frame.remove();
    return user_context.client_integrity_token;
}

async function get_display_name()
{
    if (user_context.display_name) return user_context.display_name;

    const gql_data = await gql_request(
        [
            {
                operationName: "UserDisplayName",
                query: `query UserDisplayName($login: String!) { user(login: $login, lookupType: ALL) { displayName } }`,
                variables: { login: await get_user_login() }
            }
        ]
    );
    user_context.display_name = gql_data[0]?.data?.user?.displayName ?? await get_user_login();

    return user_context.display_name;
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
        "Accept": "application/json",
        "x-device-id": await get_x_device_id()
    };

    headers["Client-Integrity"] = await get_client_integrity_token(headers);


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
        const current_resolution = preview_url.substring(preview_url.lastIndexOf("-") + 1, preview_url.lastIndexOf("."));
        preview_image.src = preview_url.replace(current_resolution, "558x330");

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
        open.target = "_blank";
        open.rel = "noopener noreferrer";
        open.textContent = "Open Stream";

        stream_card.appendChild(open);

        parent.appendChild(stream_card);
    }
}

async function get_followed_channels()
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

async function get_follower_count(user_id)
{
    const operations = [
        {
            operationName: "ChannelFollowerCount",
            query: `query ChannelFollowerCount($id: ID!) { user(id: $id) { followers { totalCount } } }`,
            variables: { "id": user_id }
        }
    ];
    const gql_data = await gql_request(operations);
    return gql_data[0]?.data?.user?.followers?.totalCount ?? 0;
}

async function get_channel_text_parts(login)
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

    const gql_data = await gql_request(operations);

    return {
        description: (gql_data[0]?.data?.user?.description ?? "").toLowerCase(),
        panels: (gql_data[1]?.data?.user?.panels ?? []).map(panel => panel.description ?? "").join(" ").toLowerCase(),
        rules: (gql_data[2]?.data?.user?.chatSettings?.rules ?? []).join(" ").toLowerCase()
    };
}

async function get_profile_image_url(login)
{
    if (blackwing_context.profile_image_cache.has(login)) return blackwing_context.profile_image_cache.get(login);

    const gql_data = await gql_request(
        [
            {
                extensions: {
                    persistedQuery: {
                        sha256Hash: "004d506dc9c3635b946941db4f1790055fd3036742f5662eecde19f54ad4ec20",
                        version: 1
                    }
                },
                operationName: "UserProfileImage",
                variables: {
                    login
                }
            }
        ]
    );

    const profile_image_url = gql_data[0]?.data?.user?.profileImageURL ?? null;
    if (!profile_image_url) return null;

    blackwing_context.profile_image_cache.set(login, profile_image_url);
    return profile_image_url;
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

function matches_tag_expression(expression, tags)
{
    try { return has_good_tags(expression, tags); }
    catch (error) { console.error("Bad tag expression:", expression, error.message); return null; }
}

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

    blackwing_context.category_nodes = gql_data[0].data.currentUser.followedGames.nodes;

    for (const node of blackwing_context.category_nodes)
        blackwing_context.category_states.set(node.slug, { cursor: undefined, finished: false, seen: new Set() });
}

async function get_recommended_channels()
{
    const load_more_button = document.getElementById("load-more-recommended");

    if (load_more_button.disabled) return;
    load_more_button.disabled = true;

    const recommended_channels = document.getElementById("recommended-channels");

    try
    {
        if (blackwing_context.category_nodes.length === 0)
            await get_category_nodes();

        const filters = await load_filters();

        let cards_added = 0;
        while (cards_added < blackwing_context.cards_per_load)
        {
            const unfinished_nodes = blackwing_context.category_nodes.filter(node => !blackwing_context.category_states.get(node.slug).finished);
            if (unfinished_nodes.length === 0)
                break;

            for (const node of unfinished_nodes)
            {
                const state = blackwing_context.category_states.get(node.slug);

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

                if (cards_added >= blackwing_context.cards_per_load)
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
        load_more_button.hidden = blackwing_context.category_nodes.length > 0 && blackwing_context.category_nodes.every(node => blackwing_context.category_states.get(node.slug).finished);
    }
}

async function refresh_followed_channels() 
{
    // const following_page = document.getElementById("following-page");
    // if (following_page.hidden) return;
    // following_page.innerHTML = "";
    // await get_followed_channels();
}

async function refresh_recommended_channels()
{
    // if (document.getElementById("recommended-page").hidden) return;
    // document.getElementById("recommended-channels").innerHTML = "";
    // await get_recommended_channels();
}

// splits "key=value;key=value" into { key: "value", ... }
function parse_tag_string(tag)
{
    const tags_by_name = {};

    // every tag is one "name=value" pair separated by ;
    for (const pair of tag.split(";"))
    {
        // split on the FIRST "=" only, since values can contain "=" themselves
        const separator_ndex = pair.indexOf("=");
        const name = pair.slice(0, separator_ndex);

        // everything after the "=" is the value (can be an empty string)
        tags_by_name[name] = pair.slice(separator_ndex + 1);
    }
    return tags_by_name;
}

// turns one raw IRC line into its parts
// "@tags :nick!user@host PRIVMSG #channel :message text"
function parse_irc_line(raw_line)
{
    // remainder is what's left to parse, each step below removes the part it handled
    let remainder = raw_line;
    let tags_by_name = {};
    let sender_prefix = "";

    // a line with tags starts with "@", the tag block ends at the first space
    if (remainder.startsWith("@"))
    {
        const tag_end_index = remainder.indexOf(" ");

        // slice(1, ...) skips the "@" itself
        tags_by_name = parse_tag_string(remainder.slice(1, tag_end_index));

        // drop the tag block and its trailing space
        remainder = remainder.slice(tag_end_index + 1);
    }

    // the sender prefix starts with ":" and ends at the next space
    if (remainder.startsWith(":"))
    {
        const prefix_end_index = remainder.indexOf(" ");

        // "nick!user@host", slice(1, ...) skips the ":"
        sender_prefix = remainder.slice(1, prefix_end_index);
        remainder = remainder.slice(prefix_end_index + 1);
    }

    // message text is everything after the first " :", so colons inside it are safe
    const trailing_text_index = remainder.indexOf(" :");

    // the part before " :" is the command and its parameters (e.g. "PRIVMSG #channel")
    const head_section = trailing_text_index === -1 ? remainder : remainder.slice(0, trailing_text_index);

    // the part after " :" is the free text (the chat message, a notice, a PING payload)
    const trailing_text = trailing_text_index === -1 ? "" : remainder.slice(trailing_text_index + 2);

    // first word is the command, the rest are parameters (the channel, for PRIVMSG)
    const [command, ...parameters] = head_section.split(" ");

    return { tags_by_name, sender_prefix, command, parameters, trailing_text };
}

// opens the socket and logs in, resolves with { send_message, close } once the channel is joined
async function open_chat_connection(channel_login, handlers = {})
{
    // both come from your twitch cookies
    const oauth_token = await get_auth_token();
    const account_login = await get_user_login();

    // a missing cookie means you aren't logged in, so there's nothing to connect with
    if (!oauth_token || !account_login)
    {
        throw new Error("Not logged into Twitch. Missing auth-token or login cookie.");
    }

    // don't connect if the page that owns the connection is already hidden
    if (blackwing_context.chat_disconnect_element.hidden)
    {
        throw new Error("chat_disconnect_element is missing or hidden");
    }

    // wrapped in a promise so the caller can await "joined and ready", not just "socket opened"
    return new Promise((resolve, reject) =>
    {
        const chat_socket = new WebSocket("wss://irc-ws.chat.twitch.tv:443");

        // guards close_connection so it only runs its cleanup once
        let connection_is_closed = false;

        // true after the first USERSTATE, so the join is only reported once
        let join_confirmed = false;

        // gives up if the join isn't confirmed within 10 seconds
        const join_timeout_id = setTimeout(() => close_connection(new Error("Timed out joining channel")), 10000);

        // fires when an attribute on the element changes, filtered to only "hidden"
        const hidden_attribute_observer = new MutationObserver(() => { if (blackwing_context.chat_disconnect_element.hidden) close_connection(); });
        hidden_attribute_observer.observe(blackwing_context.chat_disconnect_element, { attributes: true, attributeFilter: ["hidden"] });

        // the single exit path: every way the connection can end goes through here
        function close_connection(error)
        {
            // chat_socket.close() below triggers onclose, which calls this again, so bail on the second call
            if (connection_is_closed) return;
            connection_is_closed = true;

            clearTimeout(join_timeout_id);
            hidden_attribute_observer.disconnect();
            chat_socket.close();

            // if resolve already ran this does nothing, if the join never finished it rejects the await
            reject(error ?? new Error("Closed before joining channel"));
            handlers.on_close?.(error);
        }

        // one place to send, so every line goes through the same call
        function send_irc_line(irc_line)
        {
            chat_socket.send(irc_line);
        }

        // what the caller uses to send chat
        function send_message(message_text)
        {
            if (connection_is_closed) throw new Error("Chat connection is closed");

            // strip newlines so the text can't inject extra IRC commands, and respect the 500 char cap
            const clean_message_text = message_text.replace(/[\r\n]+/g, " ").slice(0, 500);
            send_irc_line(`PRIVMSG #${channel_login} :${clean_message_text}`);
        }

        // socket is connected, now ask for tags and log in (the handshake from your DevTools capture)
        chat_socket.onopen = () =>
        {
            send_irc_line("CAP REQ :twitch.tv/tags twitch.tv/commands");
            send_irc_line(`PASS oauth:${oauth_token}`);
            send_irc_line(`NICK ${account_login}`);
        };

        // runs for every frame the server sends
        chat_socket.onmessage = (message_event) =>
        {
            // one frame can hold several lines separated by \r\n
            const received_lines = message_event.data.split("\r\n").filter(Boolean);

            for (const received_line of received_lines)
            {
                const { tags_by_name, sender_prefix, command, trailing_text } = parse_irc_line(received_line);

                if (command === "PING")
                {
                    // server checks you're alive, no PONG means it drops you
                    send_irc_line(`PONG :${trailing_text}`);
                }
                else if (command === "001")
                {
                    // 001 is the welcome line, which means login worked, so it's safe to join the channel
                    send_irc_line(`JOIN #${channel_login}`);
                }
                else if (command === "USERSTATE" && !join_confirmed)
                {
                    // first USERSTATE is the reply to JOIN, so the connection is ready
                    join_confirmed = true;
                    clearTimeout(join_timeout_id);

                    // this is what the caller's await gets back
                    resolve({ send_message, close: () => close_connection() });
                }
                else if (command === "NOTICE")
                {
                    // msg-id tells you why, e.g. msg_duplicate, msg_ratelimit, msg_subsonly
                    handlers.on_notice?.(tags_by_name["msg-id"] ?? "notice", trailing_text);
                }
                else if (command === "PRIVMSG")
                {
                    // someone sent a chat message, hand the useful parts to the caller
                    handlers.on_chat_message?.(
                        {
                            // lowercase login, comes before the "!" in "nick!user@host"
                            login: sender_prefix.split("!")[0],

                            // capitalized name from the tag, falls back to the login if the tag is empty
                            display_name: tags_by_name["display-name"] || sender_prefix.split("!")[0],

                            // send time in milliseconds since 1970
                            sent_at_milliseconds: Number(tags_by_name["tmi-sent-ts"]),
                            message_text: trailing_text,

                            // all the other tags (badges, color, emotes, ...) if you need them later
                            tags_by_name
                        }
                    );
                }
            }
        };

        // the browser gives no error details for websockets, so this is a generic message
        chat_socket.onerror = () => close_connection(new Error("Chat socket error"));

        // server hung up or the network dropped
        chat_socket.onclose = () => close_connection();
    });
}


async function render_message(login, display_name, message)
{
    const chat_messages = document.getElementById("chat-messages");

    const message_div = document.createElement("div");
    message_div.className = "chat-message";

    const header = document.createElement("header");

    const profile_image = document.createElement("img");
    profile_image.src = await get_profile_image_url(login);

    const username = document.createElement("span");
    username.textContent = `${display_name}`;

    const message_text = document.createElement("p");
    message_text.textContent = `${message}`;

    header.append(profile_image, username);
    message_div.append(header, message_text);
    chat_messages.append(message_div);
}

async function send_chat(chat_connection)
{
    const send_button = document.getElementById("send-button");
    const chat_input = document.getElementById("chat-input");
    const message = chat_input.value.trim();

    if (!message) return;
    send_button.disabled = true;

    chat_connection.send_message(message);
    send_button.disabled = false;

    const login = await get_user_login();
    const username = await get_display_name();
    render_message(login, username, message);
    chat_input.value = "";
}
