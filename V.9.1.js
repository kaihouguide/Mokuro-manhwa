// ==UserScript==
// @name         Mokuro to Webtoon
// @namespace    http://tampermonkey.net/
// @version      0.9.1 // Version incremented for disabling original image alert
// @description  Transforms Mokuro manga reader HTML into a vertical webtoon style, with flexible image loading and OCR box handling. Disables original image missing alert.
// @match        file:///*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    console.log("Mokuro to Webtoon script v0.9.1 started");

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
    const FALLBACK_EXTENSIONS = ['.jpeg', '.png', '.webp', '.gif', '.avif']; // Common extensions to try

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
                background-color: var(--colorBackground, #c4c3d0); /* Fallback if CSS var not defined */
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
                background-image: none !important; /* Crucial for img tag approach */
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
                border: 1px solid rgba(0,0,0,0) !important; /* Default border, can be overridden by hover */
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.1s ease-in-out;
            }

            .pageContainer:hover .textBox { /* Show textboxes on hover over the page container */
                opacity: 1;
                pointer-events: auto; /* Allow interaction when visible */
            }

            .textBox p { /* Ensure <p> tags within .textBox are styled for readability */
                white-space: normal !important; /* Allow text wrapping */
                word-break: break-word;
            }

            /* Hide original navigation/menu elements from Mokuro's default HTML */
            #leftAPage, #rightAPage, #leftAScreen, #rightAScreen,
            #left-nav, #right-nav, /* If these IDs exist in some versions */
            #buttonLeftLeft, #buttonLeft, #buttonRight, #buttonRightRight,
            #menuDoublePageView, #menuR2l, #menuHasCover,
            #menuFitToScreen, #menuFitToWidth, #menuOriginalSize,
            #pageIdxInput, #pageIdxDisplay {
                display: none !important;
            }

            #topMenu { /* If there's a top menu from Mokuro, try to make it not take full width */
                max-width: fit-content !important;
            }
        `;
        document.head.appendChild(styleSheet);
        console.log("Webtoon CSS (v0.9.1) injected. OCR boxes on pageContainer hover.");
    }

    function applyZoom() {
        const pages = document.querySelectorAll('.page');
        const newMaxWidth = DEFAULT_PAGE_MAX_WIDTH * currentZoomLevel;
        pages.forEach(page => {
            page.style.maxWidth = `${newMaxWidth.toFixed(0)}px`;
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
                            console.warn(`Image for page ${pageEl.id} loaded but its offsetWidth is 0. Textbox repositioning might fail.`);
                        }
                        if (hasValidOriginalDimensions && newImageRenderedWidth > 0) {
                            const widthScaleFactor = newImageRenderedWidth / originalContainerWidthPx;
                            const textBoxes = container.querySelectorAll('.textBox');
                            textBoxes.forEach(textBox => {
                                const originalLeftPx = parseFloat(textBox.style.left);
                                const originalTopPx = parseFloat(textBox.style.top);
                                const originalWidthPx = parseFloat(textBox.style.width);
                                const originalHeightPx = parseFloat(textBox.style.height);
                                const originalFontSizePx = parseFloat(textBox.style.fontSize);

                                if (!isNaN(originalLeftPx)) textBox.style.left = (originalLeftPx / originalContainerWidthPx * 100) + '%';
                                if (!isNaN(originalTopPx)) textBox.style.top = (originalTopPx / originalContainerHeightPx * 100) + '%';
                                if (!isNaN(originalWidthPx)) textBox.style.width = (originalWidthPx / originalContainerWidthPx * 100) + '%';
                                if (!isNaN(originalHeightPx)) textBox.style.height = (originalHeightPx / originalContainerHeightPx * 100) + '%';

                                if (!isNaN(originalFontSizePx) && widthScaleFactor > 0) {
                                    const newFontSize = originalFontSizePx * widthScaleFactor;
                                    textBox.style.fontSize = newFontSize.toFixed(2) + 'px';
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
                console.warn(`Page ${pageIndex} (ID: ${pageEl.id}): Invalid original dimensions. Textbox repositioning/scaling may be inaccurate.`);
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
                
                container.style.backgroundImage = 'none'; // Remove original background
                container.prepend(img); // Add the img tag

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
        console.log("All pages processed for image loading and text box relocation.");
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
            'checkImagesAndAlert' // <-- ADD THIS LINE
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
        if (event.altKey || event.metaKey || event.ctrlKey) {
            return;
        }
        let scrolled = false;
        let zoomed = false;
        switch (event.key) {
            case "ArrowUp": window.scrollBy(0, -ARROW_KEY_SCROLL_AMOUNT); scrolled = true; break;
            case "ArrowDown": window.scrollBy(0, ARROW_KEY_SCROLL_AMOUNT); scrolled = true; break;
            case "+": case "=": currentZoomLevel = Math.min(MAX_ZOOM, currentZoomLevel + ZOOM_STEP); applyZoom(); zoomed = true; break;
            case "-": currentZoomLevel = Math.max(MIN_ZOOM, currentZoomLevel - ZOOM_STEP); applyZoom(); zoomed = true; break;
            case "0": currentZoomLevel = 1.0; applyZoom(); zoomed = true; break;
        }
        if (scrolled || zoomed) event.preventDefault();
    }

    function handleWheel(event) {
        if (event.ctrlKey) {
            event.preventDefault();
            if (event.deltaY < 0) currentZoomLevel += ZOOM_STEP;
            else if (event.deltaY > 0) currentZoomLevel -= ZOOM_STEP;
            currentZoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentZoomLevel));
            applyZoom();
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
        document.addEventListener('keydown', handleKeyDown, true);
        document.body.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('mouseleave', handleMouseLeaveDocument);
        document.addEventListener('wheel', handleWheel, { passive: false });
        console.log("Event listeners for scroll and zoom added.");
    }

    window.requestAnimationFrame(() => {
        setTimeout(async () => {
            try {
                disableMangaJS();
                applyWebtoonStyles();
                await processPagesAndTextBoxes();
                setupEventListeners();
                applyZoom();
                window.scrollTo(0, 0);
                console.log("Mokuro to Webtoon transformation (v0.9.1) complete.");
            } catch (error) {
                console.error("Error in Mokuro to Webtoon script:", error);
            }
        }, 100);
    });

})();