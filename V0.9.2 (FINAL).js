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
            } catch (error)
                console.error("Error in Mokuro to Webtoon script:", error);
            }
        }, 100); // Small delay
    });

})();