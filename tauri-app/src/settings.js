const { load } = window.__TAURI__.store;

window.addEventListener("DOMContentLoaded", () => init());

const settings_context = {
    storage: null
};

async function init()
{
    settings_context.storage = await load('settings.json', { autoSave: true });

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
}

async function bind_input(input_element_id)
{
    const input_element = document.getElementById(input_element_id);
    const storage_key = input_element_id.replaceAll("-", "_");

    const stored_value = await settings_context.storage.get(storage_key);

    if (stored_value !== undefined && stored_value !== null)
    {
        input_element.value = stored_value;
    }
    input_element.addEventListener("input", async (event) =>
    {
        await settings_context.storage.set(storage_key, event.target.value);
    });
}


