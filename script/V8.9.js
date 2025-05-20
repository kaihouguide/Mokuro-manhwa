// ==UserScript==
// @name         Mokuro to Webtoon
// @namespace    http://tampermonkey.net/
// @version      0.8.9 // Version incremented
// @description  Transforms Mokuro manga reader HTML into a vertical webtoon style, with arrow key/mouse drag scrolling, and zoom. OCR boxes visible on page hover (original behavior).
// @match        file:///*-Zombie-Sagashitemasu-01.html
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    console.log("Mokuro to Webtoon script v0.8.9 started"); // Updated version log

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

    function applyWebtoonStyles() {
        const styleSheet = document.createElement("style");
        styleSheet.type = "text/css";
        styleSheet.innerText = `
            html {
                overflow-y: auto !important; /* Ensure HTML can scroll */
                overflow-x: hidden !important;
                scroll-behavior: smooth;
            }

            body {
                overflow-y: visible !important; /* Body content overflows to make html scrollable */
                overflow-x: hidden !important;
                height: auto !important; /* Body height grows with content */
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
                overflow: visible !important; /* Container itself should not scroll */
                padding: 0 !important;
                border: none !important;
                transform: none !important;
                height: auto !important;
            }

            .page {
                display: block !important;
                float: none !important;
                width: 100% !important;
                max-width: ${DEFAULT_PAGE_MAX_WIDTH}px;
                height: auto !important;
                margin: 0 auto 0px auto !important; /* No bottom margin for seamless scroll */
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
                overflow: hidden; /* To contain absolutely positioned textboxes if they scale weirdly */
            }

            .pageContainer img.webtoon-image {
                display: block;
                width: 100%;
                height: auto;
                margin: 0;
                padding: 0;
                user-select: none;
                -webkit-user-drag: none;
                pointer-events: none; /* Image shouldn't interfere with body's drag scrolling */
            }

            .textBox {
                position: absolute !important;
                padding: 0 !important;
                border: 1px solid rgba(0,0,0,0) !important;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.1s ease-in-out;
            }

            .pageContainer:hover .textBox {
                opacity: 1;
                pointer-events: auto;
            }

            .textBox p {
                white-space: normal !important;
                word-break: break-word;
            }

            /* Hide original navigation/menu elements */
            #leftAPage, #rightAPage, #leftAScreen, #rightAScreen,
            #left-nav, #right-nav,
            #buttonLeftLeft, #buttonLeft, #buttonRight, #buttonRightRight,
            #menuDoublePageView, #menuR2l, #menuHasCover,
            #menuFitToScreen, #menuFitToWidth, #menuOriginalSize,
            #pageIdxInput, #pageIdxDisplay {
                display: none !important;
            }

            #topMenu { /* If there's a top menu, try to make it not take full width */
                max-width: fit-content !important;
            }
        `;
        document.head.appendChild(styleSheet);
        console.log("Webtoon CSS (v0.8.9) injected. OCR boxes on pageContainer hover.");
    }

    function applyZoom() {
        const pages = document.querySelectorAll('.page');
        const newMaxWidth = DEFAULT_PAGE_MAX_WIDTH * currentZoomLevel;
        pages.forEach(page => {
            page.style.maxWidth = `${newMaxWidth.toFixed(0)}px`;
        });
        // console.log(`Zoom applied: ${currentZoomLevel.toFixed(1)}`);
    }

    function processPagesAndTextBoxes() {
        const pageElements = document.querySelectorAll('.page');
        let promises = [];

        pageElements.forEach((pageEl, pageIndex) => {
            const container = pageEl.querySelector('.pageContainer');
            if (!container) {
                console.warn(`Page ${pageIndex} (ID: ${pageEl.id}): No .pageContainer found. Skipping.`);
                return;
            }

            const bgImageStyle = container.style.backgroundImage;
            const originalContainerWidthPx = parseFloat(container.style.width);
            const originalContainerHeightPx = parseFloat(container.style.height);

            const hasValidOriginalDimensions = !isNaN(originalContainerWidthPx) && originalContainerWidthPx > 0 &&
                                              !isNaN(originalContainerHeightPx) && originalContainerHeightPx > 0;

            if (!hasValidOriginalDimensions) {
                console.warn(`Page ${pageIndex} (ID: ${pageEl.id}): Invalid original dimensions (W: ${container.style.width}, H: ${container.style.height}). Textbox repositioning/scaling might be inaccurate.`);
            }

            if (bgImageStyle && bgImageStyle.startsWith('url("')) {
                const imageUrl = bgImageStyle.slice(5, -2);
                const img = document.createElement('img');
                img.src = imageUrl;
                img.classList.add('webtoon-image');
                img.alt = `Page image ${pageIndex + 1}`;

                container.style.backgroundImage = 'none'; // Remove background image
                container.prepend(img); // Add as an <img> element

                const promise = new Promise((resolve) => {
                    img.onload = () => {
                        const newImageRenderedWidth = img.offsetWidth;
                        if (newImageRenderedWidth === 0) {
                            // This can happen if the image isn't visible yet or has display:none from other styles
                            console.warn(`Image for page ${pageEl.id} loaded but its offsetWidth is 0. Textbox repositioning might fail.`);
                        }

                        if (hasValidOriginalDimensions && newImageRenderedWidth > 0) {
                            const widthScaleFactor = newImageRenderedWidth / originalContainerWidthPx;
                            // const heightScaleFactor = img.offsetHeight / originalContainerHeightPx; // If needed

                            const textBoxes = container.querySelectorAll('.textBox');
                            textBoxes.forEach(textBox => {
                                const originalLeftPx = parseFloat(textBox.style.left);
                                const originalTopPx = parseFloat(textBox.style.top);
                                const originalWidthPx = parseFloat(textBox.style.width);
                                const originalHeightPx = parseFloat(textBox.style.height);
                                const originalFontSizePx = parseFloat(textBox.style.fontSize);

                                // Reposition and resize textboxes based on percentage of new container size
                                if (!isNaN(originalLeftPx)) textBox.style.left = (originalLeftPx / originalContainerWidthPx * 100) + '%';
                                if (!isNaN(originalTopPx)) textBox.style.top = (originalTopPx / originalContainerHeightPx * 100) + '%';
                                if (!isNaN(originalWidthPx)) textBox.style.width = (originalWidthPx / originalContainerWidthPx * 100) + '%';
                                if (!isNaN(originalHeightPx)) textBox.style.height = (originalHeightPx / originalContainerHeightPx * 100) + '%';

                                // Scale font size
                                if (!isNaN(originalFontSizePx) && widthScaleFactor > 0) {
                                    const newFontSize = originalFontSizePx * widthScaleFactor;
                                    textBox.style.fontSize = newFontSize.toFixed(2) + 'px';

                                    // Also scale font size for <p> tags inside if they have explicit font-size
                                    textBox.querySelectorAll('p').forEach(pElem => {
                                        const pOriginalFontSize = parseFloat(pElem.style.fontSize);
                                        if (!isNaN(pOriginalFontSize)) {
                                            pElem.style.fontSize = (pOriginalFontSize * widthScaleFactor).toFixed(2) + 'px';
                                        }
                                    });
                                }
                            });
                        }
                        resolve();
                    };
                    img.onerror = () => {
                        console.error(`Failed to load image: ${imageUrl} for page ${pageEl.id}`);
                        resolve(); // Resolve even on error to not block Promise.all
                    };
                });
                promises.push(promise);
            } else {
                 console.warn(`Page ${pageIndex} (ID: ${pageEl.id}): No valid background image style found for .pageContainer.`);
            }
        });

        return Promise.all(promises).then(() => {
            console.log("All pages processed and text boxes relocated/resized (original hover behavior).");
        });
    }

    function disableMangaJS() {
        // Make pages visible early, in case original script hides them initially
        const allPagesForEarlyDisplay = document.querySelectorAll('.page');
        allPagesForEarlyDisplay.forEach(p => {
            p.style.setProperty('display', 'block', 'important');
            p.style.setProperty('order', 'initial', 'important'); // Reset order if original script used it
        });

        // Disable panzoom if it exists (common in manga readers)
        if (window.pz) {
            try {
                if (typeof window.pz.dispose === 'function') window.pz.dispose();
                else if (typeof window.pz.pause === 'function') window.pz.pause(); // Fallback
                window.pz = null; // Nullify to prevent re-initialization
            } catch (e) { console.error("Error handling panzoom (pz):", e); }
        }

        // Reset transformations on pages container if original script used them
        const pc = document.getElementById('pagesContainer');
        if (pc) {
            pc.style.setProperty('transform', 'none', 'important');
            pc.style.setProperty('transition', 'none', 'important');
            pc.style.setProperty('left', 'auto', 'important');
            pc.style.setProperty('top', 'auto', 'important');
        }

        // Neutralize common navigation functions from original scripts
        const noOp = () => {}; // No-operation function
        const functionsToDisable = [
            'updatePage', 'prevPage', 'nextPage', 'firstPage', 'lastPage',
            'inputLeftLeft', 'inputLeft', 'inputRight', 'inputRightRight',
            'zoomOriginal', 'zoomFitToWidth', 'zoomFitToScreen', 'keepZoomStart', 'zoomDefault',
            'generateConnectButtons', 'preloadImage'
            // Add other specific function names from the target Mokuro script if known
        ];
        functionsToDisable.forEach(fnName => {
            if (typeof window[fnName] === 'function') window[fnName] = noOp;
        });

        // Override state variables if the original script uses them
        if (window.state) {
            window.state.singlePageView = true; // Force single page view if applicable
            window.state.r2l = false; // Force Left-to-Right reading
            window.state.easyNav = false; // Disable any "easy navigation" overlays
            window.state.ctrlToPan = false; // Disable Ctrl to pan if it's a feature
        }

        // Cancel any ongoing animation frames from original script
        if (window.frameAnimation) { // Assuming original script uses this variable name
            window.cancelAnimationFrame(window.frameAnimation);
            window.frameAnimation = null;
        }
        console.log("Original manga JS disabled/overridden.");
    }

    function handleKeyDown(event) {
        // Don't interfere if focus is on an input element
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable) {
            return;
        }

        // Ignore if Alt or Meta (Cmd on Mac) keys are pressed, as they are usually for browser/OS shortcuts
        if (event.altKey || event.metaKey) {
            return;
        }

        // If Ctrl key is pressed, this function will not handle the event for scrolling.
        // Zoom with Ctrl+Wheel is handled in `handleWheel`.
        // Keyboard zoom (+, -, 0) works *without* Ctrl in this script.
        if (event.ctrlKey) {
            return;
        }

        let scrolled = false;
        let zoomed = false;

        switch (event.key) {
            case "ArrowUp":
                window.scrollBy(0, -ARROW_KEY_SCROLL_AMOUNT);
                scrolled = true;
                break;
            case "ArrowDown":
                window.scrollBy(0, ARROW_KEY_SCROLL_AMOUNT);
                scrolled = true;
                break;
            // Zoom keys (work without Ctrl)
            case "+": // Numpad +
            case "=": // Main keyboard = (often shares key with +)
                currentZoomLevel = Math.min(MAX_ZOOM, currentZoomLevel + ZOOM_STEP);
                applyZoom();
                zoomed = true;
                break;
            case "-": // Numpad - or main keyboard -
                currentZoomLevel = Math.max(MIN_ZOOM, currentZoomLevel - ZOOM_STEP);
                applyZoom();
                zoomed = true;
                break;
            case "0": // Main keyboard 0
                 currentZoomLevel = 1.0; // Reset zoom
                 applyZoom();
                 zoomed = true;
                 break;
        }

        if (scrolled || zoomed) {
            event.preventDefault(); // Prevent default browser action for these keys
        }
    }

    function handleWheel(event) {
        // Zoom with Ctrl + Mouse Wheel
        if (event.ctrlKey) {
            event.preventDefault(); // Prevent browser's default Ctrl+Wheel zoom AND page scroll

            if (event.deltaY < 0) { // Wheel scrolled up
                currentZoomLevel += ZOOM_STEP;
            } else if (event.deltaY > 0) { // Wheel scrolled down
                currentZoomLevel -= ZOOM_STEP;
            }

            currentZoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentZoomLevel));
            applyZoom();
        }
        // If Ctrl is not pressed, default wheel scroll behavior is allowed.
    }

    function handleMouseDown(event) {
        // Only act on left mouse button (button 0)
        // Don't start dragging if clicking on a textbox, link, button, or input field
        if (event.button !== 0 || event.target.closest('.textBox, a, button, input, select, textarea')) {
            return;
        }
        // Ensure click is within the main document area, not on potential scrollbars if body had them
        if (event.clientX >= document.documentElement.clientWidth || event.clientY >= document.documentElement.clientHeight) {
            return;
        }

        isDragging = true;
        startY = event.clientY;
        startScrollTop = window.scrollY;
        document.body.classList.add('is-dragging');
        event.preventDefault(); // Prevent text selection while dragging
    }

    function handleMouseMove(event) {
        if (!isDragging) return;
        const deltaY = event.clientY - startY;
        window.scrollTo(0, startScrollTop - deltaY);
    }

    function handleMouseUp(event) {
        if (isDragging && event.button === 0) { // Only react if dragging was active and left button released
            isDragging = false;
            document.body.classList.remove('is-dragging');
        }
    }

    function handleMouseLeaveDocument(event) {
        // If the mouse leaves the document window entirely while dragging
        if (isDragging && (event.relatedTarget === null || event.target.nodeName === 'HTML')) {
             isDragging = false;
             document.body.classList.remove('is-dragging');
        }
    }

    function setupEventListeners() {
        // ** CRITICAL FIX for key events: Listen in the CAPTURE phase **
        document.addEventListener('keydown', handleKeyDown, true); // The 'true' sets useCapture

        document.body.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('mouseleave', handleMouseLeaveDocument); // Handles mouse leaving the window
        // For `wheel` event, `passive: false` is needed if `preventDefault()` is called inside the handler
        document.addEventListener('wheel', handleWheel, { passive: false });

        console.log("Event listeners for scroll and zoom added (keydown in capture phase).");
    }

    // --- Main Execution ---
    // Use requestAnimationFrame and a short setTimeout to delay execution slightly,
    // allowing the original page scripts to potentially complete their initial setup
    // before this script modifies the DOM and disables them.
    window.requestAnimationFrame(() => {
        setTimeout(async () => {
            try {
                disableMangaJS();
                applyWebtoonStyles();
                await processPagesAndTextBoxes();
                setupEventListeners();

                applyZoom(); // Apply initial zoom level
                window.scrollTo(0, 0); // Ensure page starts at the top

                console.log("Mokuro to Webtoon transformation (v0.8.9) complete.");

            } catch (error) {
                console.error("Error in Mokuro to Webtoon script:", error);
            }
        }, 100); // 100ms delay, can be adjusted
    });

})();
