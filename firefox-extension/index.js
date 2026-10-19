import { Twitch } from "./twitch.js"

document.addEventListener("DOMContentLoaded", async () => init());

async function init()
{
    const blackwing = new Blackwing();

    blackwing.get_followed_channels();
    blackwing.get_recommended_channels();

    // document.getElementById("load-more").addEventListener("click", get_recommended_channels);
    window.setInterval(async () => { document.getElementById("followed-channels").innerHTML = ""; await blackwing.get_followed_channels(); }, 90000);
}

class Blackwing
{
    constructor()
    {
        this.twitch = new Twitch();

        this.nodes = [];
        this.states = new Map();
    }

    async get_followed_channels()
    {
        const channels = document.getElementById("followed-channels");

        const gql_data = await this.twitch.gql_request([
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
        ]);
        const edges = gql_data[0].data.currentUser.followedLiveUsers.edges;
        this.#build_cards(channels, edges);
    }

    #build_cards(parent, edges)
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
            open.textContent = "Open Stream";
            open.href=`https://www.twitch.tv/${username}`;
            open.target="_blank";
            open.rel="noopener noreferrer";
            stream_card.appendChild(open);

            parent.appendChild(stream_card);
        }
    }


    #parse_keywords(keywords)
    {
        return (keywords ?? "").split(",").map(keyword => keyword.trim().toLowerCase()).filter(Boolean);
    }

    #parse_count(number)
    {
        return /^\d+$/.test(number) ? Number(number) : null;
    }

    async #load_filters()
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
            bad_title_keywords: this.#parse_keywords(stored_settings.bad_title_keywords),
            bad_description_keywords: this.#parse_keywords(stored_settings.bad_description_keywords),
            bad_panel_keywords: this.#parse_keywords(stored_settings.bad_pannel_keywords),
            bad_rule_keywords: this.#parse_keywords(stored_settings.bad_rule_keywords),
            max_viewers: this.#parse_count(stored_settings.max_viewers),
            max_followers: this.#parse_count(stored_settings.max_followers),
            min_viewers: this.#parse_count(stored_settings.min_viewers),
            min_followers: this.#parse_count(stored_settings.min_followers)
        };
    }


    #game_query(slug, cursor = undefined)
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
                    broadcasterLanguages: ["EN"],
                    freeformTags: null,
                    includeRestricted: ["SUB_ONLY_LIVE"],
                    recommendationsContext: { platform: "web" },
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

    async #get_follower_count(user_id)
    {
        const operations = [
            {
                operationName: "ChannelFollowerCount",
                query: `query ChannelFollowerCount($id: ID!) { user(id: $id) { followers { totalCount } } }`,
                variables: { "id": user_id }
            }
        ];
        const gql_data = await this.twitch.gql_request(operations);
        return gql_data[0]?.data?.user?.followers?.totalCount ?? 0;
    }

    async #get_channel_text_parts(login)
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

        const gql_data = await this.twitch.gql_request(operations);

        return {
            description: (gql_data[0]?.data?.user?.description ?? "").toLowerCase(),
            panels: (gql_data[1]?.data?.user?.panels ?? []).map(panel => panel.description ?? "").join(" ").toLowerCase(),
            rules: (gql_data[2]?.data?.user?.chatSettings?.rules ?? []).join(" ").toLowerCase()
        };
    }

    #evaluate_boolean_expression(expression)
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
    #matches_tag_expression(expression, tags)
    {
        try
        {
            if (!/^[\w\s()]+$/.test(expression)) throw new Error("Invalid Tag Expression");
            for (const tag of tags) expression = expression.replace(new RegExp(`\\b${tag.replace(/[()]/g, "\\$&")}\\b`, "g"), "true");
            expression = expression.replace(/\b(?!true\b|and\b|or\b)\w+\b/g, "false").replace(/\band\b/g, "&&").replace(/\bor\b/g, "||");
            return this.#evaluate_boolean_expression(expression);
        }
        catch (error) 
        {
            console.error("Bad tag expression:", expression, error.message);
            return null;
        }
    }

    async #stream_passes_filters(stream, filters)
    {
        if (filters.min_viewers !== null && stream.viewersCount < filters.min_viewers) return false;
        if (filters.max_viewers !== null && stream.viewersCount > filters.max_viewers) return false;

        const stream_tags = stream.freeformTags.map(tag => tag.name.toLowerCase());

        if (filters.tag_expression && this.#matches_tag_expression(filters.tag_expression, stream_tags) === false) return false;
        if (filters.bad_tag_expression && this.#matches_tag_expression(filters.bad_tag_expression, stream_tags) === true) return false;

        const stream_title = stream.title.toLowerCase() ?? "";
        if (filters.bad_title_keywords.some(keyword => stream_title.includes(keyword))) return false;

        if (filters.min_followers !== null || filters.max_followers !== null)
        {
            const follower_count = await this.#get_follower_count(stream.broadcaster.id);
            if (filters.min_followers !== null && follower_count < filters.min_followers) return false;
            if (filters.max_followers !== null && follower_count > filters.max_followers) return false;
        }

        const needs_channel_text = filters.bad_description_keywords.length > 0
            || filters.bad_panel_keywords.length > 0
            || filters.bad_rule_keywords.length > 0;

        if (needs_channel_text)
        {
            const channel_text_parts = await this.#get_channel_text_parts(stream.broadcaster.login);
            if (filters.bad_description_keywords.some(keyword => channel_text_parts.description.includes(keyword))) return false;
            if (filters.bad_panel_keywords.some(keyword => channel_text_parts.panels.includes(keyword))) return false;
            if (filters.bad_rule_keywords.some(keyword => channel_text_parts.rules.includes(keyword))) return false;
        }

        return true;
    }

    async #get_category_nodes()
    {
        const gql_data = await this.twitch.gql_request(
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

        this.nodes = gql_data[0].data.currentUser.followedGames.nodes;

        for (const node of this.nodes)
            this.states.set(node.slug, { cursor: undefined, finished: false, seen: new Set() });
    }


    async get_recommended_channels()
    {
        const load_more_button = document.getElementById("load-more");

        if (load_more_button.disabled) return;
        load_more_button.disabled = true;

        const recommended_channels = document.getElementById("recommended-channels");

        if (this.nodes.length === 0)
            await this.#get_category_nodes();

        const filters = await this.#load_filters();

        let cards_added = 0;
        while (cards_added < 10)
        {
            const unfinished_nodes = this.nodes.filter(node => !this.states.get(node.slug).finished);
            if (unfinished_nodes.length === 0)
                break;

            for (const node of unfinished_nodes)
            {
                const state = this.states.get(node.slug);

                const response = await this.twitch.gql_request(this.#game_query(node.slug, state.cursor));

                const streams = response?.data?.game?.streams;

                if (!streams || streams.edges.length === 0)
                {
                    console.warn("finished:", node.slug, "reason: empty or missing response, errors: ", response?.errors ?? "");
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
                    if (!(await this.#stream_passes_filters(edge.node, filters)))
                        continue;

                    this.#build_cards(recommended_channels, [
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

                if (cards_added >= 10)
                    break;
            }
        }

        load_more_button.disabled = false;

        // when every game has been fully exhausted hide the Load More button
        load_more_button.hidden = this.nodes.length > 0 && this.nodes.every(node => this.states.get(node.slug).finished);

    }


}
