# Chrome Web Store listing (English)

## Name

ApiViewer

## Short description

Inspect, copy, and replay Fetch / XHR requests from the current tab in Chrome's side panel.

## Detailed description

ApiViewer is a Chrome side-panel tool for web development and API debugging. It connects to the current tab only after you open the side panel and explicitly grant permission, then shows new Fetch / XHR requests as they occur.

Key features:

- View request methods, URLs, status codes, durations, and transfer sizes
- Inspect request headers, response headers, request bodies, and response bodies
- Search requests and filter by XHR or Fetch
- Automatically format JSON content
- Copy cURL commands, request bodies, and response bodies
- Edit a request's URL, parameters, headers, and body, then resend it
- Replay requests with the current page's sign-in session
- Set request-count and response-body size limits
- Pause, resume, or clear the current capture session

Privacy and security:

- Processes Fetch / XHR requests only from the current active tab
- Connects to the Chrome debugger only while the side panel is open
- Keeps captured records only in browser memory
- Does not upload requests or responses to servers controlled by the ApiViewer developer
- Disconnects and clears the current capture session when the side panel closes
- Contains no analytics, advertising, telemetry, or remotely executed code

Request headers, response bodies, and copied cURL commands may contain cookies, Authorization headers, or other sensitive information. Do not share captured content with untrusted parties. Replayed requests access the destination endpoint for real; POST, PUT, PATCH, and DELETE requests may modify website data, so verify the target and parameters before sending.

Limitations:

- ApiViewer can show only requests made after the side panel opens
- Protected pages such as the Chrome Web Store and `chrome://` pages cannot be inspected
- Opening Chrome DevTools on the same tab may cause a debugger connection conflict
- Binary, streaming, cached, or oversized responses may not be available for preview

Privacy policy: https://hellozhongying.github.io/ApiViewer/privacy-en.html

Support: https://github.com/hellozhongying/ApiViewer/issues

## Suggested category

Developer Tools

## Language

English (en)

## Mature content

No
