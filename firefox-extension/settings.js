window.addEventListener("DOMContentLoaded", () => init());

async function init()
{
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

function bind_input(input_element_id)
{
    const input_element = document.getElementById(input_element_id);
    const storage_key = input_element_id.replaceAll("-", "_");

    browser.storage.local.get(storage_key).then((stored_values) => { input_element.value = stored_values[storage_key] ?? input_element.value; });
    input_element.addEventListener("input", (event) => { browser.storage.local.set({ [storage_key]: event.target.value }); });
}

