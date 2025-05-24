import argparse
import os
from bs4 import BeautifulSoup

# --- The JavaScript code to be injected ---
JAVASCRIPT_TO_INJECT = """
// ==UserScript==
// @name         Mokuro to Webtoon
// @namespace    http://tampermonkey.net/
// @version      0.9.2 // Version incremented for textbox positioning and dynamic font scaling fix
// @description  Transforms Mokuro manga reader HTML into a vertical webtoon style, with flexible image loading and OCR box handling. Fixes textbox positioning/scaling issues, especially on resize/zoom and mobile.
// @match        file:///*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    console.log("Mokuro to Webtoon script v0.9.2 started");

    // --- Configuration for Scrolling ---
    const ARROW_KEY_SCROLL_AMOUNT = 150;

    // --- State for Mouse Drag Scrolling ---
    let isDragging = false;
    let startY;
    let startScrollTop;

    // --- Configuration for Zooming ---
    let currentZoomLevel = 1.0;
    const ZOOM_STEP = 0.1;
    const MIN_ZOOM = 0.3;
    const MAX_ZOOM = 3.0;
    const DEFAULT_PAGE_MAX_WIDTH = 900;

    // --- Configuration for Image Fallback ---
    const FALLBACK_EXTENSIONS = ['.jpeg', '.png', '.webp', '.gif', '.avif'];

    function applyWebtoonStyles() {
        const styleSheet = document.createElement("style");
        styleSheet.type = "text/css";
        styleSheet.innerText = `
            html {
                overflow-y: auto !important;
                overflow-x: hidden !important;
                scroll-behavior: smooth;
            }

            body {
                overflow-y: visible !important;
                overflow-x: hidden !important;
                height: auto !important;
                min-height: 100%;
                background-color: var(--colorBackground, #c4c3d0);
                margin: 0;
                padding: 0;
                position: relative;
                cursor: grab;
            }

            body.is-dragging {
                cursor: grabbing !important;
            }

            #pagesContainer {
                display: flex !important;
                flex-direction: column !important;
                align-items: center;
                width: 100%;
                margin: 0 auto !important;
                overflow: visible !important;
                padding: 0 !important;
                border: none !important;
                transform: none !important;
                height: auto !important;
            }

            .page {
                display: block !important;
                float: none !important;
                width: 100% !important;
                max-width: ${DEFAULT_PAGE_MAX_WIDTH}px; /* Initial max-width */
                height: auto !important;
                margin: 0 auto 0px auto !important;
                padding: 0 !important;
                border: none !important;
                box-shadow: none !important;
                position: relative;
                order: initial !important;
                transition: max-width 0.1s ease-out;
            }

            .pageContainer {
                width: 100% !important;
                height: auto !important;
                background-image: none !important;
                position: relative !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow: hidden; /* To contain textboxes if they scale weirdly */
            }

            .pageContainer img.webtoon-image {
                display: block;
                width: 100%;
                height: auto;
                margin: 0;
                padding: 0;
                user-select: none;
                -webkit-user-drag: none;
                pointer-events: none;
            }

            .textBox {
                position: absolute !important;
                padding: 0 !important;
                border: 1px solid rgba(0,0,0,0) !important;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.1s ease-in-out, font-size 0.05s ease-out; /* Added font-size transition */
                box-sizing: content-box !important; /* Ensure width/height apply to content area */
                overflow: hidden; /* Clip overflowing text, e.g. due to browser min font size */
            }

            .pageContainer:hover .textBox {
                opacity: 1;
                pointer-events: auto;
            }

            .textBox p {
                white-space: normal !important;
                word-break: break-word;
                margin: 0; /* Remove default p margins that could affect layout */
                padding: 0; /* Remove default p paddings */
                /* Font size will be set by JS or inherited from .textBox */
            }

            #leftAPage, #rightAPage, #leftAScreen, #rightAScreen,
            #left-nav, #right-nav,
            #buttonLeftLeft, #buttonLeft, #buttonRight, #buttonRightRight,
            #menuDoublePageView, #menuR2l, #menuHasCover,
            #menuFitToScreen, #menuFitToWidth, #menuOriginalSize,
            #pageIdxInput, #pageIdxDisplay {
                display: none !important;
            }

            #topMenu {
                max-width: fit-content !important;
            }
        `;
        document.head.appendChild(styleSheet);
        console.log("Webtoon CSS (v0.9.2) injected. OCR boxes on pageContainer hover. Added box-sizing, overflow, and dynamic font scaling support.");
    }

    function applyZoom() {
        const pages = document.querySelectorAll('.page');
        const newGlobalMaxWidth = DEFAULT_PAGE_MAX_WIDTH * currentZoomLevel;

        pages.forEach(page => {
            page.style.maxWidth = `${newGlobalMaxWidth.toFixed(0)}px`;
        });

        requestAnimationFrame(() => {
            pages.forEach(page => {
                const container = page.querySelector('.pageContainer');
                const img = container ? container.querySelector('img.webtoon-image') : null;

                if (img && container) {
                    const originalContainerWidthPx = parseFloat(container.dataset.originalWidth || 0);

                    if (originalContainerWidthPx > 0) {
                        const currentImageRenderedWidth = img.offsetWidth;
                        if (currentImageRenderedWidth > 0) {
                            const currentWidthScaleFactor = currentImageRenderedWidth / originalContainerWidthPx;
                            const textBoxes = container.querySelectorAll('.textBox');

                            textBoxes.forEach(textBox => {
                                const originalFontSizePx = parseFloat(textBox.dataset.originalFontSize || 0);
                                if (!isNaN(originalFontSizePx)) {
                                    const newFontSize = originalFontSizePx * currentWidthScaleFactor;
                                    textBox.style.fontSize = newFontSize.toFixed(2) + 'px';
                                }

                                textBox.querySelectorAll('p').forEach(pElem => {
                                    if (pElem.dataset.originalPFontSize) {
                                        const pOriginalFontSize = parseFloat(pElem.dataset.originalPFontSize);
                                        if (!isNaN(pOriginalFontSize)) {
                                            const newPFontSize = pOriginalFontSize * currentWidthScaleFactor;
                                            pElem.style.fontSize = newPFontSize.toFixed(2) + 'px';
                                        }
                                    } else {
                                        pElem.style.fontSize = ''; // Clear to inherit from .textBox
                                    }
                                });
                            });
                        } else {
                             console.warn(`applyZoom: currentImageRenderedWidth is 0 for page ${page.id}. Font sizes not updated.`);
                        }
                    }
                }
            });
        });
    }


    async function loadImageWithFallback(imgElement, baseSrcWithoutExt, originalExt, fallbackExtensions, pageEl, container, hasValidOriginalDimensions, originalContainerWidthPx, originalContainerHeightPx) {
        const extensionsToTry = [originalExt, ...fallbackExtensions.filter(ext => ext.toLowerCase() !== originalExt.toLowerCase())];

        for (const ext of extensionsToTry) {
            const currentSrc = baseSrcWithoutExt + ext;
            imgElement.src = currentSrc;
            try {
                await new Promise((resolve, reject) => {
                    imgElement.onload = () => {
                        console.log(`Successfully loaded image: ${currentSrc} for page ${pageEl.id}`);
                        const newImageRenderedWidth = imgElement.offsetWidth;
                        if (newImageRenderedWidth === 0) {
                            console.warn(`Image for page ${pageEl.id} loaded but its offsetWidth is 0. Textbox repositioning/scaling might fail.`);
                        }

                        // Store original container dimensions on the container element for applyZoom
                        if (hasValidOriginalDimensions) {
                            container.dataset.originalWidth = originalContainerWidthPx;
                            container.dataset.originalHeight = originalContainerHeightPx;
                        }

                        if (hasValidOriginalDimensions && newImageRenderedWidth > 0) {
                            const initialWidthScaleFactor = newImageRenderedWidth / originalContainerWidthPx;
                            const textBoxes = container.querySelectorAll('.textBox');

                            textBoxes.forEach(textBox => {
                                const originalLeftPx = parseFloat(textBox.style.left);
                                const originalTopPx = parseFloat(textBox.style.top);
                                const originalWidthPx = parseFloat(textBox.style.width);
                                const originalHeightPx = parseFloat(textBox.style.height);
                                
                                // Convert positions and dimensions to percentages
                                if (!isNaN(originalLeftPx)) textBox.style.left = (originalLeftPx / originalContainerWidthPx * 100) + '%';
                                if (!isNaN(originalTopPx)) textBox.style.top = (originalTopPx / originalContainerHeightPx * 100) + '%';
                                if (!isNaN(originalWidthPx)) textBox.style.width = (originalWidthPx / originalContainerWidthPx * 100) + '%';
                                if (!isNaN(originalHeightPx)) textBox.style.height = (originalHeightPx / originalContainerHeightPx * 100) + '%';

                                // Handle font size for the textBox itself
                                const originalFontSizePx = parseFloat(textBox.style.fontSize);
                                if (!isNaN(originalFontSizePx)) {
                                    textBox.dataset.originalFontSize = originalFontSizePx; // Store for dynamic scaling
                                    textBox.style.fontSize = (originalFontSizePx * initialWidthScaleFactor).toFixed(2) + 'px'; // Initial scaled size
                                }

                                // Handle font sizes for <p> elements within the textBox
                                textBox.querySelectorAll('p').forEach(pElem => {
                                    const pStyleFontSize = pElem.style.fontSize;
                                    if (pStyleFontSize) { // If <p> has an inline font-size
                                        const pOriginalFontSizeValue = parseFloat(pStyleFontSize);
                                        if (!isNaN(pOriginalFontSizeValue)) {
                                            pElem.dataset.originalPFontSize = pOriginalFontSizeValue; // Store for dynamic scaling
                                            pElem.style.fontSize = (pOriginalFontSizeValue * initialWidthScaleFactor).toFixed(2) + 'px'; // Initial scaled size
                                        }
                                    }
                                    // If pElem.style.fontSize is empty, it inherits; no data-attribute or inline style set here.
                                });
                            });
                        }
                        resolve();
                    };
                    imgElement.onerror = () => {
                        reject();
                    };
                });
                return true;
            } catch (error) {
                // Continue to next extension
            }
        }
        console.error(`All attempts to load image for page ${pageEl.id} (base: ${baseSrcWithoutExt}) failed.`);
        return false;
    }


    async function processPagesAndTextBoxes() {
        const pageElements = document.querySelectorAll('.page');
        let promises = [];

        for (const [pageIndex, pageEl] of pageElements.entries()) {
            const container = pageEl.querySelector('.pageContainer');
            if (!container) {
                console.warn(`Page ${pageIndex} (ID: ${pageEl.id}): No .pageContainer found. Skipping.`);
                continue;
            }

            const bgImageStyle = container.style.backgroundImage;
            const originalContainerWidthPx = parseFloat(container.style.width);
            const originalContainerHeightPx = parseFloat(container.style.height);
            const hasValidOriginalDimensions = !isNaN(originalContainerWidthPx) && originalContainerWidthPx > 0 &&
                                              !isNaN(originalContainerHeightPx) && originalContainerHeightPx > 0;

            if (!hasValidOriginalDimensions) {
                console.warn(`Page ${pageIndex} (ID: ${pageEl.id}): Invalid original dimensions (${container.style.width}, ${container.style.height}). Textbox repositioning/scaling may be inaccurate or skipped.`);
            }

            if (bgImageStyle && bgImageStyle.startsWith('url("')) {
                let fullImageUrl = bgImageStyle.slice(5, -2);
                try {
                    fullImageUrl = decodeURIComponent(fullImageUrl);
                } catch (e) {
                    console.warn(`Could not decode URI: ${fullImageUrl}`, e);
                }

                const lastDotIndex = fullImageUrl.lastIndexOf('.');
                let baseUrlWithoutExt = fullImageUrl;
                let originalExt = '';

                if (lastDotIndex > -1 && lastDotIndex > fullImageUrl.lastIndexOf('/')) {
                    baseUrlWithoutExt = fullImageUrl.substring(0, lastDotIndex);
                    originalExt = fullImageUrl.substring(lastDotIndex);
                } else {
                    console.warn(`No original extension for ${fullImageUrl}. Trying fallbacks.`);
                }

                const img = document.createElement('img');
                img.classList.add('webtoon-image');
                img.alt = `Page image ${pageIndex + 1}`;

                container.style.backgroundImage = 'none';
                container.prepend(img);

                const promise = loadImageWithFallback(
                    img, baseUrlWithoutExt, originalExt, FALLBACK_EXTENSIONS,
                    pageEl, container, hasValidOriginalDimensions, originalContainerWidthPx, originalContainerHeightPx
                );
                promises.push(promise);
            } else {
                 console.warn(`Page ${pageIndex} (ID: ${pageEl.id}): No valid background image style or not a URL.`);
            }
        }

        await Promise.all(promises);
        console.log("All pages processed for image loading and text box relocation/styling.");
    }


    function disableMangaJS() {
        const allPagesForEarlyDisplay = document.querySelectorAll('.page');
        allPagesForEarlyDisplay.forEach(p => {
            p.style.setProperty('display', 'block', 'important');
            p.style.setProperty('order', 'initial', 'important');
        });

        if (window.pz) {
            try {
                if (typeof window.pz.dispose === 'function') window.pz.dispose();
                else if (typeof window.pz.pause === 'function') window.pz.pause();
                window.pz = null;
            } catch (e) { console.error("Error handling panzoom (pz):", e); }
        }

        const pc = document.getElementById('pagesContainer');
        if (pc) {
            pc.style.setProperty('transform', 'none', 'important');
            pc.style.setProperty('transition', 'none', 'important');
            pc.style.setProperty('left', 'auto', 'important');
            pc.style.setProperty('top', 'auto', 'important');
        }

        const noOp = () => {};
        const functionsToDisable = [
            'updatePage', 'prevPage', 'nextPage', 'firstPage', 'lastPage',
            'inputLeftLeft', 'inputLeft', 'inputRight', 'inputRightRight',
            'zoomOriginal', 'zoomFitToWidth', 'zoomFitToScreen', 'keepZoomStart', 'zoomDefault',
            'generateConnectButtons', 'preloadImage',
            'checkImagesAndAlert'
        ];
        functionsToDisable.forEach(fnName => {
            if (typeof window[fnName] === 'function') {
                console.log(`Mokuro to Webtoon: Disabling original function: window.${fnName}`);
                window[fnName] = noOp;
            }
        });

        if (window.state) {
            window.state.singlePageView = true;
            window.state.r2l = false;
            window.state.easyNav = false;
            window.state.ctrlToPan = false;
        }

        if (window.frameAnimation) {
            window.cancelAnimationFrame(window.frameAnimation);
            window.frameAnimation = null;
        }
        console.log("Original manga JS (including image alert) disabled/overridden.");
    }

    function handleKeyDown(event) {
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable) {
            return;
        }
        if (event.altKey || event.metaKey || event.ctrlKey) { // Allow Ctrl for zoom via wheel
             if (!event.ctrlKey || (event.key !== '=' && event.key !== '-' && event.key !== '0' && event.key !== '+')) { // Specifically allow ctrl+plus/minus/0 for zoom
                return;
            }
        }
        let scrolled = false;
        let zoomed = false;
        switch (event.key) {
            case "ArrowUp": window.scrollBy(0, -ARROW_KEY_SCROLL_AMOUNT); scrolled = true; break;
            case "ArrowDown": window.scrollBy(0, ARROW_KEY_SCROLL_AMOUNT); scrolled = true; break;
            case "+": case "=":
                if (event.ctrlKey || !event.altKey && !event.metaKey) { // Allow Ctrl+= or just =
                    currentZoomLevel = Math.min(MAX_ZOOM, currentZoomLevel + ZOOM_STEP); applyZoom(); zoomed = true;
                }
                break;
            case "-":
                if (event.ctrlKey || !event.altKey && !event.metaKey) { // Allow Ctrl+- or just -
                    currentZoomLevel = Math.max(MIN_ZOOM, currentZoomLevel - ZOOM_STEP); applyZoom(); zoomed = true;
                }
                break;
            case "0":
                if (event.ctrlKey || !event.altKey && !event.metaKey) { // Allow Ctrl+0 or just 0
                    currentZoomLevel = 1.0; applyZoom(); zoomed = true;
                }
                break;
        }
        if (scrolled || zoomed) event.preventDefault();
    }

    function handleWheel(event) {
        if (event.ctrlKey) {
            event.preventDefault();
            const prevZoomLevel = currentZoomLevel;
            if (event.deltaY < 0) currentZoomLevel += ZOOM_STEP;
            else if (event.deltaY > 0) currentZoomLevel -= ZOOM_STEP;
            currentZoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentZoomLevel));
            if (currentZoomLevel !== prevZoomLevel) {
                applyZoom();
            }
        }
    }

    function handleMouseDown(event) {
        if (event.button !== 0 || event.target.closest('.textBox, a, button, input, select, textarea')) return;
        if (event.clientX >= document.documentElement.clientWidth || event.clientY >= document.documentElement.clientHeight) return;
        isDragging = true;
        startY = event.clientY;
        startScrollTop = window.scrollY;
        document.body.classList.add('is-dragging');
        event.preventDefault();
    }

    function handleMouseMove(event) {
        if (!isDragging) return;
        window.scrollTo(0, startScrollTop - (event.clientY - startY));
    }

    function handleMouseUp(event) {
        if (isDragging && event.button === 0) {
            isDragging = false;
            document.body.classList.remove('is-dragging');
        }
    }

    function handleMouseLeaveDocument(event) {
        if (isDragging && (event.relatedTarget === null || event.target.nodeName === 'HTML')) {
             isDragging = false;
             document.body.classList.remove('is-dragging');
        }
    }

    function setupEventListeners() {
        document.addEventListener('keydown', handleKeyDown, true); // Use true for capture phase to potentially override other listeners
        document.body.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('mouseleave', handleMouseLeaveDocument); // Changed to document to catch leaving window
        document.addEventListener('wheel', handleWheel, { passive: false });
        console.log("Event listeners for scroll and zoom added.");
    }

    // Ensure the DOM is fully ready and initial layout has occurred
    window.requestAnimationFrame(() => {
        // Further delay to ensure Mokuro's own setup (if any residual) might have finished
        setTimeout(async () => {
            try {
                disableMangaJS();
                applyWebtoonStyles();
                await processPagesAndTextBoxes(); // This now stores original sizes and sets initial scaled sizes
                setupEventListeners();
                applyZoom(); // Apply initial zoom level (1.0 by default), this will also correctly scale fonts
                window.scrollTo(0, 0);
                console.log("Mokuro to Webtoon transformation (v0.9.2) complete.");
            } catch (error) {
                console.error("Error in Mokuro to Webtoon script:", error);
            }
        }, 100); // Small delay
    });

})();
"""

# Unique ID for the injected script to prevent duplicate injections
INJECTED_SCRIPT_ID = "mokuro-to-webtoon-userscript-injected"

def inject_script_to_html(html_file_path, final_output_path):
    """
    Injects the JAVASCRIPT_TO_INJECT into the given HTML file and saves it.
    """
    try:
        with open(html_file_path, 'r', encoding='utf-8') as f:
            html_content = f.read()
    except FileNotFoundError:
        raise
    except Exception as e:
        raise

    soup = BeautifulSoup(html_content, 'html.parser')

    existing_script = soup.find('script', id=INJECTED_SCRIPT_ID)
    if existing_script:
        print(f"  Script '{INJECTED_SCRIPT_ID}' already found. Replacing it.")
        existing_script.decompose()
    else:
        print(f"  Injecting script '{INJECTED_SCRIPT_ID}'.")

    new_script_tag = soup.new_tag('script')
    new_script_tag['type'] = 'text/javascript'
    new_script_tag['id'] = INJECTED_SCRIPT_ID
    new_script_tag.string = JAVASCRIPT_TO_INJECT

    target_element = soup.body or soup.head or soup.html
    if target_element:
        if not soup.body and soup.head:
             print("  Warning: <body> tag not found. Appending script to <head>.")
        elif not soup.body and not soup.head and soup.html:
             print("  Warning: <body> and <head> not found. Appending script to root <html>.")
        target_element.append(new_script_tag)
    else:
        raise Exception("No <html>, <head>, or <body> tag found. Cannot inject script.")

    try:
        output_dir = os.path.dirname(final_output_path)
        if output_dir: # Only create if final_output_path implies a subdirectory
            os.makedirs(output_dir, exist_ok=True)

        with open(final_output_path, 'w', encoding='utf-8') as f:
            f.write(str(soup))
        print(f"  Successfully saved: {final_output_path}")
    except Exception as e:
        raise

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Injects a specific JavaScript into HTML file(s) or all HTML files in specified directorie(s) for Mokuro webtoon style.",
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument(
        "input_paths",
        nargs='+',
        help="Path(s) to input HTML file(s) and/or directorie(s) containing HTML files."
             "\n(e.g., 'manga-ch1.html' 'my_manga_folder/' './another_folder')."
    )
    parser.add_argument(
        "-o", "--output",
        help="Output file path (if single resolved input file & output is a file name), "
             "or output directory (if multiple resolved input files, or single input & output is a directory path). "
             "\nIf not provided, input file(s) will be overwritten (with a single confirmation at the start)."
    )
    parser.add_argument(
        "-y", "--yes",
        action="store_true",
        help="Automatically confirm all overwrites. Use with caution."
    )

    args = parser.parse_args()

    # --- 1. Resolve input_paths to a list of actual HTML files ---
    resolved_html_files = set() # Use a set to avoid duplicates
    for path_arg in args.input_paths:
        path_arg = os.path.abspath(path_arg) # Normalize path
        if os.path.isfile(path_arg):
            if path_arg.lower().endswith(('.html', '.htm')):
                resolved_html_files.add(path_arg)
            else:
                print(f"Warning: Skipping non-HTML file specified directly: {path_arg}")
        elif os.path.isdir(path_arg):
            print(f"Scanning directory: {path_arg}")
            found_in_dir = 0
            for item in os.listdir(path_arg):
                item_path = os.path.join(path_arg, item)
                if os.path.isfile(item_path) and item_path.lower().endswith(('.html', '.htm')):
                    resolved_html_files.add(item_path)
                    found_in_dir +=1
            if found_in_dir == 0:
                print(f"  No .html or .htm files found in directory: {path_arg}")
            else:
                print(f"  Found {found_in_dir} HTML file(s) in {path_arg}")
        else:
            print(f"Warning: Input path not found or not a file/directory: {path_arg}")

    actual_files_to_process = sorted(list(resolved_html_files)) # Convert to sorted list for consistent order

    if not actual_files_to_process:
        print("No HTML files found to process. Exiting.")
        exit(0)

    print(f"\nTotal unique HTML files to process: {len(actual_files_to_process)}")
    # --- End of input file resolution ---


    # --- 2. Validate --output based on the number of resolved files ---
    if args.output and len(actual_files_to_process) > 1:
        # If output is specified and there are multiple files, output MUST be a directory
        if os.path.exists(args.output) and not os.path.isdir(args.output):
            print(f"Error: Output path '{args.output}' is an existing file. "
                  "For multiple input files, --output must specify a directory.")
            exit(1)
    # --- End of output validation ---


    # --- 3. Handle overwrite confirmation if no -o is given ---
    proceed_with_overwrites = False
    if not args.output: # Overwrite mode is active
        if args.yes:
            proceed_with_overwrites = True
            print("\nOverwrite mode: -y specified, all input files will be overwritten if possible.")
        else:
            num_files_to_overwrite = len(actual_files_to_process)
            plural_s = "s" if num_files_to_overwrite > 1 else ""
            confirm_msg = (
                f"\nNo output destination specified. This will attempt to overwrite "
                f"{num_files_to_overwrite} resolved input file{plural_s}.\n"
                "Are you sure you want to proceed with overwriting ALL applicable files? (yes/no): "
            )
            initial_confirm = input(confirm_msg).lower()
            if initial_confirm == 'yes':
                proceed_with_overwrites = True
                print("Overwrite mode: Confirmed. Applicable input files will be overwritten.")
            else:
                print("Operation cancelled by user. No files will be overwritten.")
                exit(0)
    # --- End of overwrite confirmation ---

    # --- 4. Process each resolved file ---
    total_files = len(actual_files_to_process)
    processed_count = 0
    skipped_count = 0

    for i, input_path in enumerate(actual_files_to_process):
        print(f"\n[{i+1}/{total_files}] Processing: {input_path}")

        actual_output_path = ""

        if args.output:
            if len(actual_files_to_process) > 1: # Multiple resolved files -> output must be dir
                # Ensure output directory exists (or can be created)
                if not os.path.exists(args.output):
                     os.makedirs(args.output, exist_ok=True)
                     print(f"  Created output directory: {args.output}")
                elif not os.path.isdir(args.output): # Should have been caught by pre-validation
                    print(f"  Internal Error: Output path '{args.output}' is not a directory.")
                    skipped_count += 1
                    continue
                actual_output_path = os.path.join(args.output, os.path.basename(input_path))
            else: # Single resolved file with -o argument
                if args.output.endswith(os.path.sep) or \
                   (os.path.exists(args.output) and os.path.isdir(args.output)): # Output is a dir
                    if not os.path.exists(args.output):
                        os.makedirs(args.output, exist_ok=True)
                        print(f"  Created output directory: {args.output}")
                    actual_output_path = os.path.join(args.output, os.path.basename(input_path))
                else: # Output is a specific file name
                    actual_output_path = args.output
        else: # Overwrite mode
            if not proceed_with_overwrites: # Should have exited if user said no
                print(f"  Skipping overwrite for {input_path} (internal safeguard).")
                skipped_count += 1
                continue
            actual_output_path = input_path
        
        # Userscript @match filename check/warning (optional)
        # For the new script, the @match is file:///*, so this specific warning is less relevant
        # but kept for structure.
        # expected_filename_part = "-Zombie-Sagashitemasu-01.html" 
        # if expected_filename_part not in os.path.basename(input_path):
        #     print(f"  Warning: Input filename '{os.path.basename(input_path)}' "
        #           f"does not match the example pattern ('{expected_filename_part}') "
        #           "from the userscript's @match directive. "
        #           "The script will be injected, but it might not be the intended file type.")

        try:
            inject_script_to_html(input_path, actual_output_path)
            processed_count += 1
        except FileNotFoundError:
            print(f"  Error: Input file not found during processing: {input_path}") 
            skipped_count += 1
        except Exception as e:
            print(f"  Error processing file {input_path}: {e}")
            skipped_count += 1
    
    print(f"\n--- Batch Processing Summary ---")
    print(f"Total unique HTML files considered: {total_files}")
    print(f"Successfully processed: {processed_count}")
    print(f"Skipped or failed:    {skipped_count}")