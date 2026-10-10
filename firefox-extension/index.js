document.addEventListener("DOMContentLoaded", async () => init());

let auth_token = null;


async function init()
{
    // const test_element = document.getElementById("test");

    // const ops = [

    // ];
    // const gql_data = await gql_request(ops);

    // test_element.textContent = JSON.stringify(gql_data);

    load_live_followed_channels();
    load_recommended_channels();
    document.getElementById("settings-button").addEventListener("click", toggle_settings_menu);

    document.getElementById("followed-categories").value = (await browser.storage.local.get("followed_categories")).followed_categories ?? document.getElementById("followed-categories").value;
    document.getElementById("followed-categories").addEventListener("input", async (event) => { await browser.storage.local.set({ followed_categories: event.target.value }); });

    document.getElementById("filter-tags").value = (await browser.storage.local.get("filter_tags")).filter_tags ?? document.getElementById("filter-tags").value;
    document.getElementById("filter-tags").addEventListener("input", async (event) => { await browser.storage.local.set({ filter_tags: event.target.value }); });

    document.getElementById("bad-description-keywords").value = (await browser.storage.local.get("bad_description_keywords")).bad_description_keywords ?? document.getElementById("bad-description-keywords").value;
    document.getElementById("bad-description-keywords").addEventListener("input", async (event) => { await browser.storage.local.set({ bad_description_keywords: event.target.value }); });

    document.getElementById("bad-pannel-keywords").value = (await browser.storage.local.get("bad_pannel_keywords")).bad_pannel_keywords ?? document.getElementById("bad-pannel-keywords").value;
    document.getElementById("bad-pannel-keywords").addEventListener("input", async (event) => { await browser.storage.local.set({ bad_pannel_keywords: event.target.value }); });
    
    document.getElementById("bad-rule-keywords").value = (await browser.storage.local.get("bad_rule_keywords")).bad_rule_keywords ?? document.getElementById("bad-rule-keywords").value;
    document.getElementById("bad-rule-keywords").addEventListener("input", async (event) => { await browser.storage.local.set({ bad_rule_keywords: event.target.value }); });

    document.getElementById("max-viewers").value = (await browser.storage.local.get("max_viewers")).max_viewers ?? document.getElementById("max-viewers").value;
    document.getElementById("max-viewers").addEventListener("input", async (event) => { await browser.storage.local.set({ max_viewers: event.target.value }); });
    
    document.getElementById("max-followers").value = (await browser.storage.local.get("max_followers")).max_followers ?? document.getElementById("max-followers").value;
    document.getElementById("max-followers").addEventListener("input", async (event) => { await browser.storage.local.set({ max_followers: event.target.value }); });

    document.getElementById("min-viewers").value = (await browser.storage.local.get("min_viewers")).min_viewers ?? document.getElementById("min-viewers").value;
    document.getElementById("min-viewers").addEventListener("input", async (event) => { await browser.storage.local.set({ min_viewers: event.target.value }); });

    document.getElementById("min-followers").value = (await browser.storage.local.get("min_followers")).min_followers ?? document.getElementById("min-followers").value;
    document.getElementById("min-followers").addEventListener("input", async (event) => { await browser.storage.local.set({ min_followers: event.target.value }); });
}

async function toggle_settings_menu()
{
    const front_page = document.getElementById("front-page");
    const settings_page = document.getElementById("settings-page");
    front_page.hidden = !front_page.hidden;
    settings_page.hidden = !settings_page.hidden;
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
        preview_image.src = node.stream.previewImageURL;

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

async function load_live_followed_channels()
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
                limit: 30
            }
        }
    ];
    const gql_data = await gql_request(operations);
    const edges = gql_data[0].data.currentUser.followedLiveUsers.edges;

    build_cards(followed_live_channels, edges);
}

function game_query(slug)
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
            imageWidth: 50,
            includeCostreaming: true,
            limit: 30,
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

async function load_recommended_channels()
{
    const recommended_channels = document.getElementById("recommended-channels");

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

    const nodes = gql_data[0].data.currentUser.followedGames.nodes;

    gql_data.push(await gql_request(nodes.map(node => game_query(node.slug))));



    for (const query of gql_data[1])
    {
        const edges = query.data.game.streams.edges.map(edge => ({
            node: {
                profileImageURL: edge.node.broadcaster.profileImageURL,
                displayName: edge.node.broadcaster.displayName,
                login: edge.node.broadcaster.login,
                stream: edge.node
            }
        }));
        build_cards(recommended_channels, edges);
    }
}

//PYTHON def join_set(s: set | None) -> str: return ", ".join(sorted(s)) if s else ""
function join_set(set) { return (!Array.isArray(set) || set.length === 0) ? "" : [...new Set(set)].sort().join(", "); }

//PYTHON def parse_csv_set(value: str) -> set: return {x.strip().lower() for x in value.split(",") if x.strip()}
function parse_csv(csv) { return [...new Set(csv.split(",").map(value => value.trim().toLowerCase()))]; }

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