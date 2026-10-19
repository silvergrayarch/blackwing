
// const chat_context = {
//     profile_image_cache: new Map(),

//     chat_connection: null,
//     chat_disconnect_element: document.getElementById("watching-page")
// };

// const video_player_context = {
//     player_type: null,
//     channel_login: null,
//     backup_media_playlist_url: null
// };

    // document.getElementById("send-button").addEventListener("click", () => send_chat());
    // document.getElementById("chat-input").addEventListener("keydown", (keyboard_event) => { if (keyboard_event.key === "Enter" && !keyboard_event.shiftKey) send_chat(); });


// async function get_playback_access_token()
// {
//     const gql_data = await gql_request(
//         [
//             {
//                 operationName: "PlaybackAccessToken_Template",
//                 query: `query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!, $platform: String!) {  streamPlaybackAccessToken(channelName: $login, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) {    value    signature   authorization { isForbidden forbiddenReasonCode }   __typename  }  videoPlaybackAccessToken(id: $vodID, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) {    value    signature   __typename  }}`,
//                 variables: { isLive: true, login: video_player_context.channel_login, isVod: false, vodID: "", playerType: video_player_context.player_type, platform: video_player_context.player_type === "autoplay" ? "android" : "web" }
//             }
//         ]
//     );

//     const stream_access_token = gql_data[0]?.data?.streamPlaybackAccessToken ?? null;

//     if (!stream_access_token)
//     {
//         console.error("Twitch returned no stream playback token.", gql_data[0]?.errors);
//         return null;
//     }

//     if (stream_access_token.authorization?.isForbidden)
//     {
//         console.warn(`Twitch forbids this stream: ${stream_access_token.authorization.forbiddenReasonCode}`);
//         return null;
//     }

//     if (!stream_access_token.value || !stream_access_token.signature)
//     {
//         console.error("Playback token or signature is empty.", {
//             hasValue: Boolean(stream_access_token.value),
//             hasSignature: Boolean(stream_access_token.signature)
//         });
//         return null;
//     }

//     return stream_access_token;
// }


// async function get_profile_image_url(login)
// {
//     if (chat_context.profile_image_cache.has(login)) return chat_context.profile_image_cache.get(login);

//     const gql_data = await gql_request(
//         [
//             {
//                 extensions: {
//                     persistedQuery: {
//                         sha256Hash: "004d506dc9c3635b946941db4f1790055fd3036742f5662eecde19f54ad4ec20",
//                         version: 1
//                     }
//                 },
//                 operationName: "UserProfileImage",
//                 variables: {
//                     login
//                 }
//             }
//         ]
//     );

//     const profile_image_url = gql_data[0]?.data?.user?.profileImageURL ?? null;
//     if (!profile_image_url) return null;

//     chat_context.profile_image_cache.set(login, profile_image_url);
//     return profile_image_url;
// }

// async function refresh_recommended_channels()
// {
//     // if (document.getElementById("recommended-page").hidden) return;
//     // document.getElementById("recommended-channels").innerHTML = "";
//     // await get_recommended_channels();
// }

// // splits "key=value;key=value" into { key: "value", ... }
// function parse_tag_string(tag)
// {
//     const tags_by_name = {};

//     // every tag is one "name=value" pair separated by ;
//     for (const pair of tag.split(";"))
//     {
//         // split on the FIRST "=" only, since values can contain "=" themselves
//         const separator_ndex = pair.indexOf("=");
//         const name = pair.slice(0, separator_ndex);

//         // everything after the "=" is the value (can be an empty string)
//         tags_by_name[name] = pair.slice(separator_ndex + 1);
//     }
//     return tags_by_name;
// }

// // turns one raw IRC line into its parts
// // "@tags :nick!user@host PRIVMSG #channel :message text"
// function parse_irc_line(raw_line)
// {
//     // remainder is what's left to parse, each step below removes the part it handled
//     let remainder = raw_line;
//     let tags_by_name = {};
//     let sender_prefix = "";

//     // a line with tags starts with "@", the tag block ends at the first space
//     if (remainder.startsWith("@"))
//     {
//         const tag_end_index = remainder.indexOf(" ");

//         // slice(1, ...) skips the "@" itself
//         tags_by_name = parse_tag_string(remainder.slice(1, tag_end_index));

//         // drop the tag block and its trailing space
//         remainder = remainder.slice(tag_end_index + 1);
//     }

//     // the sender prefix starts with ":" and ends at the next space
//     if (remainder.startsWith(":"))
//     {
//         const prefix_end_index = remainder.indexOf(" ");

//         // "nick!user@host", slice(1, ...) skips the ":"
//         sender_prefix = remainder.slice(1, prefix_end_index);
//         remainder = remainder.slice(prefix_end_index + 1);
//     }

//     // message text is everything after the first " :", so colons inside it are safe
//     const trailing_text_index = remainder.indexOf(" :");

//     // the part before " :" is the command and its parameters (e.g. "PRIVMSG #channel")
//     const head_section = trailing_text_index === -1 ? remainder : remainder.slice(0, trailing_text_index);

//     // the part after " :" is the free text (the chat message, a notice, a PING payload)
//     const trailing_text = trailing_text_index === -1 ? "" : remainder.slice(trailing_text_index + 2);

//     // first word is the command, the rest are parameters (the channel, for PRIVMSG)
//     const [command, ...parameters] = head_section.split(" ");

//     return { tags_by_name, sender_prefix, command, parameters, trailing_text };
// }

// // opens the socket and logs in, resolves with { send_message, close } once the channel is joined
// async function open_chat_connection(channel_login, handlers = {})
// {
//     // both come from your twitch cookies
//     const oauth_token = await get_auth_token();
//     const account_login = await get_user_login();

//     // a missing cookie means you aren't logged in, so there's nothing to connect with
//     if (!oauth_token || !account_login)
//     {
//         throw new Error("Not logged into Twitch. Missing auth-token or login cookie.");
//     }

//     // don't connect if the page that owns the connection is already hidden
//     if (chat_context.chat_disconnect_element.hidden)
//     {
//         throw new Error("chat_disconnect_element is missing or hidden");
//     }

//     // wrapped in a promise so the caller can await "joined and ready", not just "socket opened"
//     return new Promise((resolve, reject) =>
//     {
//         const chat_socket = new WebSocket("wss://irc-ws.chat.twitch.tv:443");

//         // guards close_connection so it only runs its cleanup once
//         let connection_is_closed = false;

//         // true after the first USERSTATE, so the join is only reported once
//         let join_confirmed = false;

//         // gives up if the join isn't confirmed within 10 seconds
//         const join_timeout_id = setTimeout(() => close_connection(new Error("Timed out joining channel")), 10000);

//         // fires when an attribute on the element changes, filtered to only "hidden"
//         const hidden_attribute_observer = new MutationObserver(() => { if (chat_context.chat_disconnect_element.hidden) close_connection(); });
//         hidden_attribute_observer.observe(chat_context.chat_disconnect_element, { attributes: true, attributeFilter: ["hidden"] });

//         // the single exit path: every way the connection can end goes through here
//         function close_connection(error)
//         {
//             if (connection_is_closed) return;
//             connection_is_closed = true;

//             clearTimeout(join_timeout_id);
//             hidden_attribute_observer.disconnect();

//             if (chat_socket.readyState < WebSocket.CLOSING)
//                 chat_socket.close();

//             if (!join_confirmed)
//                 reject(error ?? new Error("Closed before joining channel"));

//             handlers.on_close?.(error);
//         }

//         // one place to send, so every line goes through the same call
//         function send_irc_line(irc_line)
//         {
//             chat_socket.send(irc_line);
//         }

//         // what the caller uses to send chat
//         function send_message(message_text)
//         {
//             if (connection_is_closed) throw new Error("Chat connection is closed");

//             // strip newlines so the text can't inject extra IRC commands, and respect the 500 char cap
//             const clean_message_text = message_text.replace(/[\r\n]+/g, " ").slice(0, 500);
//             send_irc_line(`PRIVMSG #${channel_login} :${clean_message_text}`);
//         }

//         // socket is connected, now ask for tags and log in (the handshake from your DevTools capture)
//         chat_socket.onopen = () =>
//         {
//             send_irc_line("CAP REQ :twitch.tv/tags twitch.tv/commands");
//             send_irc_line(`PASS oauth:${oauth_token}`);
//             send_irc_line(`NICK ${account_login}`);
//         };

//         // runs for every frame the server sends
//         chat_socket.onmessage = (message_event) =>
//         {
//             // one frame can hold several lines separated by \r\n
//             const received_lines = message_event.data.split("\r\n").filter(Boolean);

//             for (const received_line of received_lines)
//             {
//                 const { tags_by_name, sender_prefix, command, trailing_text } = parse_irc_line(received_line);

//                 if (command === "PING")
//                 {
//                     // server checks you're alive, no PONG means it drops you
//                     send_irc_line(`PONG :${trailing_text}`);
//                 }
//                 else if (command === "001")
//                 {
//                     // 001 is the welcome line, which means login worked, so it's safe to join the channel
//                     send_irc_line(`JOIN #${channel_login}`);
//                 }
//                 else if (command === "USERSTATE" && !join_confirmed)
//                 {
//                     // first USERSTATE is the reply to JOIN, so the connection is ready
//                     join_confirmed = true;
//                     clearTimeout(join_timeout_id);

//                     // this is what the caller's await gets back
//                     resolve({ send_message, close: () => close_connection() });
//                 }
//                 else if (command === "NOTICE")
//                 {
//                     // msg-id tells you why, e.g. msg_duplicate, msg_ratelimit, msg_subsonly
//                     handlers.on_notice?.(tags_by_name["msg-id"] ?? "notice", trailing_text);
//                 }
//                 else if (command === "PRIVMSG")
//                 {
//                     // someone sent a chat message, hand the useful parts to the caller
//                     handlers.on_chat_message?.(
//                         {
//                             // lowercase login, comes before the "!" in "nick!user@host"
//                             login: sender_prefix.split("!")[0],

//                             // capitalized name from the tag, falls back to the login if the tag is empty
//                             display_name: tags_by_name["display-name"] || sender_prefix.split("!")[0],

//                             // send time in milliseconds since 1970
//                             sent_at_milliseconds: Number(tags_by_name["tmi-sent-ts"]),
//                             message_text: trailing_text,

//                             // all the other tags (badges, color, emotes, ...) if you need them later
//                             tags_by_name
//                         }
//                     );
//                 }
//             }
//         };

//         // the browser gives no error details for websockets, so this is a generic message
//         chat_socket.onerror = () => close_connection(new Error("Chat socket error"));

//         // server hung up or the network dropped
//         chat_socket.onclose = (event) =>
//         {
//             close_connection(
//                 new Error(`WebSocket closed: ${event.code} ${event.reason}`)
//             );
//         };
//     });
// }


// async function render_message(login, display_name, message)
// {
//     const chat_messages = document.getElementById("chat-messages");

//     const message_div = document.createElement("div");
//     message_div.className = "chat-message";

//     const header = document.createElement("header");

//     const profile_image = document.createElement("img");
//     profile_image.src = await get_profile_image_url(login);

//     const username = document.createElement("span");
//     username.textContent = `${display_name}`;

//     const message_text = document.createElement("p");
//     message_text.textContent = `${message}`;

//     header.append(profile_image, username);
//     message_div.append(header, message_text);
//     chat_messages.append(message_div);
// }

// async function send_chat()
// {
//     const send_button = document.getElementById("send-button");
//     const chat_input = document.getElementById("chat-input");
//     const message = chat_input.value.trim();

//     if (!message) return;
//     send_button.disabled = true;

//     chat_context.chat_connection.send_message(message);
//     send_button.disabled = false;

//     const login = await get_user_login();
//     const username = await get_display_name();
//     render_message(login, username, message);
//     chat_input.value = "";
// }

// function build_usher_url(access_token)
// {
//     const usher_url = new URL(`https://usher.ttvnw.net/api/channel/hls/${video_player_context.channel_login}.m3u8`);
//     usher_url.searchParams.set("sig", access_token.signature);
//     usher_url.searchParams.set("token", access_token.value);
//     usher_url.searchParams.set("p", String(Math.floor(Math.random() * 999999)));
//     usher_url.searchParams.set("allow_source", "true");
//     usher_url.searchParams.set("allow_audio_only", "true");
//     usher_url.searchParams.set("supported_codecs", "h264");
//     return usher_url.toString();
// }

// function get_variant_url(playlist, index)
// {
//     const variant_urls = [];
//     const playlist_lines = playlist.split("\n");
//     for (let line_index = 0; line_index < playlist_lines.length; line_index++)
//     {
//         // the line after each STREAM-INF tag is that quality's url
//         if (playlist_lines[line_index].startsWith("#EXT-X-STREAM-INF:"))
//         {
//             variant_urls.push(playlist_lines[line_index + 1]);
//         }
//     }
//     return variant_urls[index];
// }

// function is_ad_daterange(daterange_attributes)
// {
//     return daterange_attributes["CLASS"] === "twitch-stitched-ad"
//         || (daterange_attributes["ID"] ?? "").startsWith("stitched-ad-")
//         || Object.keys(daterange_attributes).some((attribute_name) => attribute_name.startsWith("X-TV-TWITCH-AD-"));
// }

// // collects the milliseconds that are ads
// function get_ad_date_ranges(playlist_text)
// {
//     const ad_date_ranges = []; // { start_milliseconds, end_milliseconds }
//     for (const playlist_line of playlist_text.split("\n"))
//     {
//         if (!playlist_line.startsWith("#EXT-X-DATERANGE:")) continue;

//         const daterange_attributes = {};

//         // turns KEY=value,KEY="quoted value" into { KEY: "value" }
//         for (const attribute_match of playlist_line.slice("#EXT-X-DATERANGE:".length).matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g))
//         {
//             // group 1 is the name, group 2 the value, with surrounding quotes removed
//             daterange_attributes[attribute_match[1]] = attribute_match[2].replace(/^"|"$/g, "");
//         }

//         if (!is_ad_daterange(daterange_attributes)) continue;

//         const start_milliseconds = Date.parse(daterange_attributes["START-DATE"]);
//         const duration_seconds = Number(daterange_attributes["DURATION"] ?? daterange_attributes["PLANNED-DURATION"]);
//         const end_milliseconds = daterange_attributes["END-DATE"] ? Date.parse(daterange_attributes["END-DATE"]) : (Number.isFinite(duration_seconds) ? start_milliseconds + duration_seconds * 1000 : Infinity);

//         ad_date_ranges.push({ start_milliseconds, end_milliseconds });
//     }
//     return ad_date_ranges;
// }

// // true if the playlist currently contains ads
// function playlist_has_ads(playlist_text)
// {
//     return get_ad_date_ranges(playlist_text).length > 0 || /^#EXTINF:[^,]*,.*Amazon/m.test(playlist_text);
// }

// // streamlink's approach: drop the ad segments from the playlist
// function strip_ad_segments(playlist_text)
// {
//     const ad_date_ranges = get_ad_date_ranges(playlist_text);   // windows to cut
//     const kept_lines = [];                                      // playlist lines that survive
//     let pending_segment_lines = [];                             // date + EXTINF lines waiting for their url line
//     let running_date_milliseconds = null;                       // wall clock time of the current segment
//     let segment_duration_milliseconds = 0;                      // length of the current segment
//     let segment_title = "";                                     // EXTINF title of the current segment
//     let removed_leading_segments = 0;                           // ad segments removed before the first kept one
//     let kept_any_segment = false;                               // flips true after the first kept segment

//     for (const playlist_line of playlist_text.split("\n"))
//     {
//         if (playlist_line.startsWith("#EXT-X-TWITCH-PREFETCH")) continue;           // prefetch urls would leak ads, drop them

//         if (playlist_line.startsWith("#EXT-X-PROGRAM-DATE-TIME:"))
//         {
//             running_date_milliseconds = Date.parse(playlist_line.slice("#EXT-X-PROGRAM-DATE-TIME:".length)); // segment start time
//             pending_segment_lines.push(playlist_line);                              // keep with its segment
//         }
//         else if (playlist_line.startsWith("#EXTINF:"))
//         {
//             const [duration_text, ...title_parts] = playlist_line.slice("#EXTINF:".length).split(","); // "2.000,title"
//             segment_duration_milliseconds = Number(duration_text) * 1000;           // seconds to milliseconds
//             segment_title = title_parts.join(",");                                  // title may contain commas
//             pending_segment_lines.push(playlist_line);                              // keep with its segment
//         }
//         else if (playlist_line.startsWith("#") || playlist_line.trim() === "")
//         {
//             kept_lines.push(playlist_line);                                         // header and other tags pass through
//         }
//         else
//         {
//             // this line is a segment url, decide if the segment is an ad
//             const segment_is_ad = !segment_title.includes("live")   // vaft's test, real segments are titled "live", ad segments aren't
//                 || segment_title.includes("Amazon")                  // streamlink's title test
//                 || (running_date_milliseconds !== null && ad_date_ranges.some((ad_date_range) => // streamlink's date test
//                     running_date_milliseconds >= ad_date_range.start_milliseconds   // after the ad starts
//                     && running_date_milliseconds < ad_date_range.end_milliseconds)); // and before it ends

//             if (segment_is_ad)
//             {
//                 if (!kept_any_segment) removed_leading_segments++;                  // count removals at the front
//             }
//             else
//             {
//                 kept_lines.push(...pending_segment_lines, playlist_line);           // keep date, EXTINF and url
//                 kept_any_segment = true;                                            // later removals are not leading
//             }

//             pending_segment_lines = [];                                             // reset for the next segment
//             segment_title = "";                                                     // reset title
//             if (running_date_milliseconds !== null) running_date_milliseconds += segment_duration_milliseconds; // next segment starts after this one
//         }
//     }

//     // move the media sequence forward by the removed leading segments so kept segments keep their numbers
//     return kept_lines.join("\n").replace(/#EXT-X-MEDIA-SEQUENCE:(\d+)/, (whole_tag, sequence_text) =>
//         `#EXT-X-MEDIA-SEQUENCE:${Number(sequence_text) + removed_leading_segments}`);
// }

// // vaft's approach: look for a backup player type whose playlist has no ads
// async function find_clean_backup_playlist()
// {
//     let clean_backup_playlist = null; // stays null if every backup has ads

//     for (const player_type of ["popout", "embed", "mobile_web", "autoplay"])
//     {
//         video_player_context.player_type = player_type;

//         const access_token = await get_playback_access_token();
//         if (!access_token) continue;

//         const master_playlist = await fetch_text(build_usher_url(access_token));
//         if (!master_playlist) continue;

//         const media_playlist_url = get_variant_url(master_playlist, 0);
//         if (!media_playlist_url) continue;

//         const media_playlist_text = await fetch_text(media_playlist_url);
//         if (media_playlist_text && !playlist_has_ads(media_playlist_text))
//         {
//             clean_backup_playlist = { media_playlist_url, media_playlist_text };
//             break;
//         }
//     }

//     video_player_context.player_type = "popout";
//     return clean_backup_playlist;
// }

// // decides what playlist text hls.js gets on every refresh
// async function get_clean_playlist_text(site_playlist_text)
// {
//     if (!playlist_has_ads(site_playlist_text))
//     {
//         video_player_context.backup_media_playlist_url = null;
//         return site_playlist_text;
//     }

//     if (video_player_context.backup_media_playlist_url)
//     {
//         const cached_backup_text = await fetch_text(video_player_context.backup_media_playlist_url);
//         if (cached_backup_text && !playlist_has_ads(cached_backup_text)) return cached_backup_text;
//         video_player_context.backup_media_playlist_url = null;
//     }

//     const backup_playlist = await find_clean_backup_playlist();
//     if (backup_playlist)
//     {
//         video_player_context.backup_media_playlist_url = backup_playlist.media_playlist_url;
//         return backup_playlist.media_playlist_text;
//     }

//     return strip_ad_segments(site_playlist_text);
// }

// class AdFilteringLoader extends Hls.DefaultConfig.loader
// {
//     load(load_context, load_config, load_callbacks)
//     {
//         // first load is "manifest", refreshes are "level", video segments are neither
//         const is_playlist_request = load_context.type === "manifest" || load_context.type === "level";
//         if (is_playlist_request)
//         {
//             const original_on_success = load_callbacks.onSuccess;   // hls.js's own success handler
//             load_callbacks.onSuccess = async (response, stats, success_context, network_details) =>
//             {
//                 // try/catch: if filtering fails hls.js must still get the original playlist or playback stalls
//                 try
//                 {
//                     response.data = await get_clean_playlist_text(response.data);   // swap in the filtered playlist
//                 }
//                 catch (error)
//                 {
//                     console.error("Ad filtering failed:", error.message);
//                 }
//                 original_on_success(response, stats, success_context, network_details); // hand it to hls.js
//             };
//         }
//         super.load(load_context, load_config, load_callbacks);      // do the normal request
//     }
// }

// // entry point: plays a live channel in a <video> element
// async function play_channel(channel_login, video_element)
// {
//     video_player_context.player_type = "popup";
//     video_player_context.channel_login = channel_login;
//     video_player_context.backup_media_playlist_url = null;

//     const playback_token = await get_playback_access_token();
//     if (!playback_token)
//     {
//         console.error("No playback token");
//         return null;
//     }


//     const master_playlist = await fetch_text(build_usher_url(playback_token));

//     if (!master_playlist)
//     {
//         console.error("Usher refused the request. The channel is probably offline.");
//         return null;
//     }

//     const media_playlist_url = get_variant_url(master_playlist, 0);    // source quality

//     const hls_player = new Hls({ loader: AdFilteringLoader });  // hls.js using our loader
//     hls_player.loadSource(media_playlist_url);                  // play the media playlist directly
//     hls_player.attachMedia(video_element);                      // draw into the video element
//     video_element.play();                                       // start playback
//     return hls_player;                                          // call .destroy() on it when the page hides
// }