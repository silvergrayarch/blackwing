const { load } = window.__TAURI__.store;

window.addEventListener("DOMContentLoaded", () => init());

const user_context = {
    login: null,
    display_name: null,
    auth_token: null,
    x_device_id: null,
    client_integrity_token: null
};

const recommended_context = {
    nodes: [],
    states: new Map(),
};

const settings_context = {
    storage: null
};

async function init()
{
   settings_context.storage = await load('settings.json', { autoSave: true });
   document.getElementById("load-more").addEventListener("click", get_recommended_channels);

}

async function get_filter(filter)
{
    return await settings_context.storage.get(filter);
}

function parse_keywords(value)
{
    return (value ?? "").split(",").map(keyword => keyword.trim().toLowerCase()).filter(Boolean);
}

function parse_count(value)
{
    return /^\d+$/.test(value) ? Number(value) : null;
}

async function load_filters()
{
    return {
        tag_expression: (await get_filter("filter_tags") ?? "").trim().toLowerCase(),
        bad_tag_expression: (await get_filter("bad_tags")  ?? "").trim().toLowerCase(),
        bad_title_keywords: parse_keywords(await get_filter("bad_title_keywords")),
        bad_description_keywords: parse_keywords(await get_filter("bad_description_keywords")),
        bad_panel_keywords: parse_keywords(await get_filter("bad_pannel_keywords")),
        bad_rule_keywords: parse_keywords(await get_filter("bad_rule_keywords")),
        max_viewers: parse_count(await get_filter("max_viewers")),
        max_followers: parse_count(await get_filter("max_followers")),
        min_viewers: parse_count(await get_filter("min_viewers")),
        min_followers: parse_count(await get_filter("min_followers"))
    };
}



