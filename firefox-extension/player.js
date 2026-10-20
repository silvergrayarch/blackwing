import { Twitch } from "./twitch.js"

document.addEventListener("DOMContentLoaded", async () => init());



async function init()
{
    const player = new Player();
    document.getElementById("logo").addEventListener("click", () => { player.chat_connection.close(); });
    document.getElementById("send-button").addEventListener("click", () => player.send_chat());
    document.getElementById("chat-input").addEventListener("keydown", (keyboard_event) => { if (keyboard_event.key === "Enter" && !keyboard_event.shiftKey) player.send_chat(); });

    player.play_channel();

    // This will log the width of the viewport
    console.log(window.innerWidth);

    // This will log the width of the frame viewport within a frameset
    console.log(self.innerWidth);
}

class Player
{
    constructor()
    {
        this.twitch = new Twitch();
        this.login = Array.from(new URLSearchParams(new URL(window.location.href).searchParams).entries())[0][1];
        console.log(this.login);
        this.player_type = null;
        this.chat_connection = null;
        this.profile_image_cache = new Map();
        this.backup_media_playlist_url = null;
    }

    async #fetch_text(url)
    {
        const response = await fetch(url);
        if (!response.ok) return null;
        return response.text();
    }

    async  #get_playback_access_token()
    {
        const gql_data = await this.twitch.gql_request(
            [
                {
                    operationName: "PlaybackAccessToken_Template",
                    query: `query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!, $platform: String!) {  streamPlaybackAccessToken(channelName: $login, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) {    value    signature   authorization { isForbidden forbiddenReasonCode }   __typename  }  videoPlaybackAccessToken(id: $vodID, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) {    value    signature   __typename  }}`,
                    variables: { isLive: true, login: this.login, isVod: false, vodID: "", playerType: this.player_type, platform: this.player_type === "autoplay" ? "android" : "web" }
                }
            ]
        );

        const stream_access_token = gql_data[0]?.data?.streamPlaybackAccessToken ?? null;

        if (!stream_access_token)
        {
            console.error("Twitch returned no stream playback token.", gql_data[0]?.errors);
            return null;
        }

        if (stream_access_token.authorization?.isForbidden)
        {
            console.warn(`Twitch forbids this stream: ${stream_access_token.authorization.forbiddenReasonCode}`);
            return null;
        }

        if (!stream_access_token.value || !stream_access_token.signature)
        {
            console.error("Playback token or signature is empty.", {
                hasValue: Boolean(stream_access_token.value),
                hasSignature: Boolean(stream_access_token.signature)
            });
            return null;
        }

        return stream_access_token;
    }

    async #get_profile_image_url(login)
    {
        if (this.profile_image_cache.has(login)) return this.profile_image_cache.get(login);

        const gql_data = await this.twitch.gql_request(
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

        this.profile_image_cache.set(login, profile_image_url);
        return profile_image_url;
    }

    #parse_tag_string(string)
    {
        const tags = {};

        for (const pair of string.split(";"))
        {
            const separator_ndex = pair.indexOf("=");
            const name = pair.slice(0, separator_ndex);

            tags[name] = pair.slice(separator_ndex + 1);
        }
        return tags;
    }


    #parse_irc_line(raw_line)
    {
        let remainder = raw_line;
        let tags_by_name = {};
        let sender_prefix = "";


        if (remainder.startsWith("@"))
        {
            const tag_end_index = remainder.indexOf(" ");
            tags_by_name = this.#parse_tag_string(remainder.slice(1, tag_end_index));
            remainder = remainder.slice(tag_end_index + 1);
        }

        if (remainder.startsWith(":"))
        {
            const prefix_end_index = remainder.indexOf(" ");
            sender_prefix = remainder.slice(1, prefix_end_index);
            remainder = remainder.slice(prefix_end_index + 1);
        }

        const trailing_text_index = remainder.indexOf(" :");
        const head_section = trailing_text_index === -1 ? remainder : remainder.slice(0, trailing_text_index);
        const trailing_text = trailing_text_index === -1 ? "" : remainder.slice(trailing_text_index + 2);
        const [command, ...parameters] = head_section.split(" ");

        return { tags_by_name, sender_prefix, command, parameters, trailing_text };
    }

    async open_chat_connection(handlers = {})
    {
        const oauth_token = await this.twitch.get_auth_token();
        const account_login = await this.twitch.get_login();

        if (!oauth_token || !account_login)
        {
            throw new Error("Not logged into Twitch. Missing auth-token or login cookie.");
        }

        // wrapped in a promise so the caller can await "joined and ready", not just "socket opened"
        return new Promise((resolve, reject) =>
        {
            const chat_socket = new WebSocket("wss://irc-ws.chat.twitch.tv:443");

            let connection_is_closed = false;
            let join_confirmed = false;

            const join_timeout_id = setTimeout(() => close_connection(new Error("Timed out joining channel")), 10000);

            function close_connection(error)
            {
                if (connection_is_closed) return;
                connection_is_closed = true;

                clearTimeout(join_timeout_id);

                if (chat_socket.readyState < WebSocket.CLOSING)
                    chat_socket.close();

                if (!join_confirmed)
                    reject(error ?? new Error("Closed before joining channel"));

                handlers.on_close?.(error);
            }

            function send_irc_line(irc_line)
            {
                chat_socket.send(irc_line);
            }

            const send_message = (message_text) =>
            {
                if (connection_is_closed) throw new Error("Chat connection is closed");

                const clean_message_text = message_text.replace(/[\r\n]+/g, " ").slice(0, 500);
                send_irc_line(`PRIVMSG #${this.login} :${clean_message_text}`);
            };

            chat_socket.onopen = () =>
            {
                send_irc_line("CAP REQ :twitch.tv/tags twitch.tv/commands");
                send_irc_line(`PASS oauth:${oauth_token}`);
                send_irc_line(`NICK ${account_login}`);
            };

            chat_socket.onmessage = (message_event) =>
            {
                const received_lines = message_event.data.split("\r\n").filter(Boolean);

                for (const received_line of received_lines)
                {
                    const { tags_by_name, sender_prefix, command, trailing_text } = this.#parse_irc_line(received_line);

                    if (command === "PING")
                    {
                        send_irc_line(`PONG :${trailing_text}`);
                    }
                    else if (command === "001")
                    {
                        send_irc_line(`JOIN #${this.login}`);
                    }
                    else if (command === "USERSTATE" && !join_confirmed)
                    {
                        join_confirmed = true;
                        clearTimeout(join_timeout_id);
                        resolve({ send_message, close: () => close_connection() });
                    }
                    else if (command === "NOTICE")
                    {
                        handlers.on_notice?.(tags_by_name["msg-id"] ?? "notice", trailing_text);
                    }
                    else if (command === "PRIVMSG")
                    {
                        handlers.on_chat_message?.(
                            {
                                login: sender_prefix.split("!")[0],
                                display_name: tags_by_name["display-name"] || sender_prefix.split("!")[0],
                                // sent_at_milliseconds: Number(tags_by_name["tmi-sent-ts"]),
                                message_text: trailing_text,

                                // all the other tags (badges, color, emotes, ...) if you need them later
                                tags_by_name
                            }
                        );
                    }
                }
            };

            chat_socket.onerror = () => close_connection(new Error("Chat socket error"));

            // server hung up or the network dropped
            chat_socket.onclose = (event) =>
            {
                close_connection(
                    new Error(`WebSocket closed: ${event.code} ${event.reason}`)
                );
            };
        });
    }

    async render_message(login, display_name, message)
    {
        const chat_messages = document.getElementById("chat-messages");

        if (chat_messages.childElementCount > 30)
        {
            chat_messages.firstElementChild.remove();
        }

        const message_div = document.createElement("div");
        message_div.className = "chat-message";

        const header = document.createElement("header");

        const profile_image = document.createElement("img");
        profile_image.src = await this.#get_profile_image_url(login);

        const username = document.createElement("span");
        username.textContent = `${display_name}`;

        const message_text = document.createElement("p");
        message_text.textContent = `${message}`;

        header.append(profile_image, username);
        message_div.append(header, message_text);
        chat_messages.append(message_div);
    }

    async send_chat()
    {
        const send_button = document.getElementById("send-button");
        const chat_input = document.getElementById("chat-input");
        const message = chat_input.value.trim();

        if (!message) return;
        send_button.disabled = true;

        this.chat_connection.send_message(message);
        send_button.disabled = false;

        const login = await this.twitch.get_login();
        const username = await this.twitch.get_display_name();
        this.render_message(login, username, message);
        chat_input.value = "";
    }


    #build_usher_url(access_token)
    {
        const usher_url = new URL(`https://usher.ttvnw.net/api/channel/hls/${this.login}.m3u8`);
        usher_url.searchParams.set("sig", access_token.signature);
        usher_url.searchParams.set("token", access_token.value);
        usher_url.searchParams.set("p", String(Math.floor(Math.random() * 999999)));
        usher_url.searchParams.set("allow_source", "true");
        usher_url.searchParams.set("allow_audio_only", "true");
        usher_url.searchParams.set("supported_codecs", "h264");
        return usher_url.toString();
    }

    #get_variant_url(playlist, index)
    {
        const variant_urls = [];
        const playlist_lines = playlist.split("\n");
        for (let line_index = 0; line_index < playlist_lines.length; line_index++)
        {
            // the line after each STREAM-INF tag is that quality's url
            if (playlist_lines[line_index].startsWith("#EXT-X-STREAM-INF:"))
            {
                variant_urls.push(playlist_lines[line_index + 1]);
            }
        }
        return variant_urls[index];
    }

    // collects the milliseconds that are ads
    #get_ad_date_ranges(playlist_text)
    {
        const ad_date_ranges = []; // { start_milliseconds, end_milliseconds }
        for (const playlist_line of playlist_text.split("\n"))
        {
            if (!playlist_line.startsWith("#EXT-X-DATERANGE:")) continue;

            const daterange_attributes = {};

            // KEY=value,KEY="quoted value" -> { KEY: "value" }
            for (const attribute_match of playlist_line.slice("#EXT-X-DATERANGE:".length).matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g))
            {
                // 1 is name, 2 is value, surrounding quotes removed
                daterange_attributes[attribute_match[1]] = attribute_match[2].replace(/^"|"$/g, "");
            }

            if (!(daterange_attributes["CLASS"] === "twitch-stitched-ad" || (daterange_attributes["ID"] ?? "").startsWith("stitched-ad-") || Object.keys(daterange_attributes).some((attribute_name) => attribute_name.startsWith("X-TV-TWITCH-AD-"))))
                continue;

            const start_milliseconds = Date.parse(daterange_attributes["START-DATE"]);
            const duration_seconds = Number(daterange_attributes["DURATION"] ?? daterange_attributes["PLANNED-DURATION"]);
            const end_milliseconds = daterange_attributes["END-DATE"] ? Date.parse(daterange_attributes["END-DATE"]) : (Number.isFinite(duration_seconds) ? start_milliseconds + duration_seconds * 1000 : Infinity);

            ad_date_ranges.push({ start_milliseconds, end_milliseconds });
        }
        return ad_date_ranges;
    }

    #playlist_has_ads(playlist_text)
    {
        return this.#get_ad_date_ranges(playlist_text).length > 0 || /^#EXTINF:[^,]*,.*Amazon/m.test(playlist_text);
    }

    // drop the ad segments from the playlist if switching playlists doesn't work
    #strip_ad_segments(playlist_text)
    {
        const ad_date_ranges = this.#get_ad_date_ranges(playlist_text);   // windows to cut
        const kept_lines = [];                                            // playlist lines that survive
        let pending_segment_lines = [];                                   // date + EXTINF lines waiting for their url line
        let running_date_milliseconds = null;                             // wall clock time of the current segment
        let segment_duration_milliseconds = 0;                            // length of the current segment
        let segment_title = "";                                           // EXTINF title of the current segment
        let removed_leading_segments = 0;                                 // ad segments removed before the first kept one
        let kept_any_segment = false;                                     // flips true after the first kept segment

        for (const playlist_line of playlist_text.split("\n"))
        {
            if (playlist_line.startsWith("#EXT-X-TWITCH-PREFETCH")) continue;           // prefetch urls would leak ads, drop them

            if (playlist_line.startsWith("#EXT-X-PROGRAM-DATE-TIME:"))
            {
                running_date_milliseconds = Date.parse(playlist_line.slice("#EXT-X-PROGRAM-DATE-TIME:".length)); // segment start time
                pending_segment_lines.push(playlist_line);                              // keep with its segment
            }
            else if (playlist_line.startsWith("#EXTINF:"))
            {
                const [duration_text, ...title_parts] = playlist_line.slice("#EXTINF:".length).split(","); // "2.000,title"
                segment_duration_milliseconds = Number(duration_text) * 1000;           // seconds to milliseconds
                segment_title = title_parts.join(",");                                  // title may contain commas
                pending_segment_lines.push(playlist_line);                              // keep with its segment
            }
            else if (playlist_line.startsWith("#") || playlist_line.trim() === "")
            {
                kept_lines.push(playlist_line);                                         // header and other tags pass through
            }
            else
            {
                // this line is a segment url, decide if the segment is an ad
                const segment_is_ad = !segment_title.includes("live")                                // real segments are titled "live", ad segments aren't
                    || segment_title.includes("Amazon")                                              // title test
                    || (running_date_milliseconds !== null && ad_date_ranges.some((ad_date_range) => // date test
                        running_date_milliseconds >= ad_date_range.start_milliseconds                // after the ad starts
                        && running_date_milliseconds < ad_date_range.end_milliseconds));             // and before it ends

                if (segment_is_ad)
                {
                    if (!kept_any_segment) removed_leading_segments++;
                }
                else
                {
                    kept_lines.push(...pending_segment_lines, playlist_line);
                    kept_any_segment = true;
                }

                pending_segment_lines = [];
                segment_title = "";
                if (running_date_milliseconds !== null) running_date_milliseconds += segment_duration_milliseconds;
            }
        }

        return kept_lines.join("\n").replace(/#EXT-X-MEDIA-SEQUENCE:(\d+)/, (whole_tag, sequence_text) => `#EXT-X-MEDIA-SEQUENCE:${Number(sequence_text) + removed_leading_segments}`);
    }

    // look for a backup player type whose playlist has no ads
    async #find_clean_backup_playlist()
    {
        let clean_backup_playlist = null; // stays null if every backup has ads

        for (const player_type of ["popout", "embed", "mobile_web", "autoplay"])
        {
            this.player_type = player_type;

            const access_token = await this.#get_playback_access_token();
            if (!access_token) continue;

            const master_playlist = await this.#fetch_text(this.#build_usher_url(access_token));
            if (!master_playlist) continue;

            const media_playlist_url = this.#get_variant_url(master_playlist, 0);
            if (!media_playlist_url) continue;

            const media_playlist_text = await this.#fetch_text(media_playlist_url);
            if (media_playlist_text && !this.#playlist_has_ads(media_playlist_text))
            {
                clean_backup_playlist = { media_playlist_url, media_playlist_text };
                break;
            }
        }

        this.player_type = "popout";
        return clean_backup_playlist;
    }


    async #get_clean_playlist_text(site_playlist_text)
    {
        if (!this.#playlist_has_ads(site_playlist_text))
        {
            this.backup_media_playlist_url = null;
            return site_playlist_text;
        }

        if (this.backup_media_playlist_url)
        {
            const cached_backup_text = await this.#fetch_text(this.backup_media_playlist_url);
            if (cached_backup_text && !this.#playlist_has_ads(cached_backup_text)) return cached_backup_text;
            this.backup_media_playlist_url = null;
        }

        const backup_playlist = await this.#find_clean_backup_playlist();
        if (backup_playlist)
        {
            this.backup_media_playlist_url = backup_playlist.media_playlist_url;
            return backup_playlist.media_playlist_text;
        }

        return this.#strip_ad_segments(site_playlist_text);
    }


    #build_ad_filtering_loader()
    {
        const player = this;   // captured, because `this` inside load() is the loader

        return class AdFilteringLoader extends Hls.DefaultConfig.loader
        {
            load(load_context, load_config, load_callbacks)
            {
                const is_playlist_request = load_context.type === "manifest" || load_context.type === "level";

                if (is_playlist_request)
                {
                    const original_on_success = load_callbacks.onSuccess;

                    load_callbacks.onSuccess = async (response, stats, success_context, network_details) =>
                    {
                        try
                        {
                            response.data = await player.#get_clean_playlist_text(response.data);
                        }
                        catch (error)
                        {
                            console.error("Ad filtering failed:", error.message);
                        }
                        original_on_success(response, stats, success_context, network_details);
                    };
                }

                super.load(load_context, load_config, load_callbacks);
            }
        };
    }

    // entry point: plays a live channel in a <video> element
    async play_channel()
    {
        this.chat_connection = await this.open_chat_connection(
            {
                on_chat_message: (chat_message) => this.render_message(chat_message.login, chat_message.display_name, chat_message.message_text),
                on_notice: (notice_id, notice_text) => console.warn(notice_id, notice_text),
                on_close: (error) => console.log("chat closed", error?.message ?? "")
            }
        );

        const video_element = document.getElementById("video-player");

        this.player_type = "popout";
        this.backup_media_playlist_url = null;

        const playback_token = await this.#get_playback_access_token();
        if (!playback_token)
        {
            console.error("No playback token");
            return null;
        }

        const master_playlist = await this.#fetch_text(this.#build_usher_url(playback_token));

        if (!master_playlist)
        {
            console.error("Usher refused the request. The channel is probably offline.");
            return null;
        }

        const media_playlist_url = this.#get_variant_url(master_playlist, 0);
        const hls_player = new Hls({ loader: this.#build_ad_filtering_loader(), lowLatencyMode: true, liveSyncDuration: 1, liveMaxLatencyDuration: 5, maxLiveSyncPlaybackRate: 1.5, backBufferLength: 10 });
        hls_player.attachMedia(video_element);
        hls_player.loadSource(media_playlist_url);
        video_element.play();
        return hls_player;
    }
}



