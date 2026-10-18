const { load } = window.__TAURI__.http;

window.addEventListener("DOMContentLoaded", () => init());

const user_context = {
    login: null,
    display_name: null,
    auth_token: null,
    x_device_id: null,
    client_integrity_token: null
};


// twitch refuses to be framed, so strip the headers that block it
function strip_frame_blocking_headers(details)
{
    return {
        responseHeaders: details.responseHeaders.filter((header) =>
            !["x-frame-options", "content-security-policy"].includes(header.name.toLowerCase()))
    };
}

async function init()
{
    const twitch_frame = document.getElementById("twitch-login");
    twitch_frame.src = "https://www.example.com";
    // <iframe href="//www.youtube.com/watch?v=lJIrF4YjHfQ" data-videoid="lJIrF4YjHfQ" class="embedded-video-large" frameborder="0" allowfullscreen="" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" title="Embed videos and playlists" width="400" height="230" src="https://www.youtube.com/embed/lJIrF4YjHfQ"></iframe>

    // twitch_frame.is="x-frame-bypass";
    // webRequest.onHeadersReceived.addListener(strip_frame_blocking_headers, request_filter, ["blocking", "responseHeaders"]);

}