// ==UserScript==
// @name         WME Junction Cleaner
// @namespace    https://github.com/Mr-Leonerrr
// @version      0.2.0-beta
// @description  Highlight and remove redundant junction nodes in Waze Map Editor.
// @author       LeonerNinja
// @match        https://*.waze.com/*/editor*
// @match        https://*.waze.com/editor*
// @homepageURL  https://github.com/Mr-Leonerrr/wme-junction-cleaner
// @supportURL   https://github.com/Mr-Leonerrr/wme-junction-cleaner/issues
// @license      MIT
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
    "use strict";

    // ==========================================
    // Constants
    // ==========================================

    const SCRIPT_ID = "wme-junction-cleaner";
    const SCRIPT_NAME = "WME Junction Cleaner";
    const LAYER_NAME = `${SCRIPT_ID}-highlighter`;
    const HIGHLIGHT_RADIUS = 6;
    const HIGHLIGHT_COLOR = "#FF00FF";
    const FLOATING_BUTTON_ID = `${SCRIPT_ID}-floating-button`;
    const FLOATING_POSITION_KEY = `${SCRIPT_ID}-floating-position`;

    // ==========================================
    // State
    // ==========================================

    let wmeSDK = null;
    let isRefreshing = false;
    let pendingRefresh = false;
    let isCleaning = false;

    const sdkHost = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

    async function initialize() {
        if (!sdkHost.SDK_INITIALIZED) {
            throw new Error("SDK_INITIALIZED is unavailable.");
        }

        await sdkHost.SDK_INITIALIZED;

        if (!sdkHost.getWmeSdk) {
            throw new Error("WME SDK is not available.");
        }

        wmeSDK = sdkHost.getWmeSdk({
            scriptId: SCRIPT_ID,
            scriptName: SCRIPT_NAME,
            mode: "async"
        });

        await wmeSDK.Events.once({ eventName: "wme-ready" });
        await initializeHighlighter();
        await initializeCleaner();

        initializeFloatingButton();
    }

    // Highlighter and sidebar

    async function initializeHighlighter() {
        await createHighlightLayer();

        wmeSDK.Events.on({
            eventName: "wme-map-data-loaded",
            eventHandler: refreshHighlights
        });

        wmeSDK.Events.on({
            eventName: "wme-after-edit",
            eventHandler: refreshHighlights
        });

        wmeSDK.Events.on({
            eventName: "wme-after-undo",
            eventHandler: refreshHighlights
        });

        await refreshHighlights();

    }

    async function initializeCleaner() {
        const { tabLabel, tabPane } =
              await wmeSDK.Sidebar.registerScriptTab();

        tabLabel.textContent = "JC";

        tabPane.innerHTML = `
        <div style="padding: 15px;">
            <h3>WME Junction Cleaner</h3>

            <hr>

            <p>
                Select a segment to remove redundant
                junction nodes.
            </p>

            <button
                id="${SCRIPT_ID}-clean"
                style="
                    width: 100%;
                    padding: 10px;
                    background: #2563eb;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                "
            >
                Clean Junctions
            </button>

            <p
                id="${SCRIPT_ID}-status"
                style="margin-top: 10px;"
            >
                Waiting for selection...
            </p>
        </div>
    `;

        const cleanButton = tabPane.querySelector(
            `#${SCRIPT_ID}-clean`
        );

        const status = tabPane.querySelector(
            `#${SCRIPT_ID}-status`
        );

        cleanButton.addEventListener("click", async () => {
            cleanButton.disabled = true;

            status.textContent = "Analyzing segments...";

            try {
                status.textContent = await cleanSelectedSegment();

            } catch (error) {
                status.textContent = `Error: ${error.message}`;

                console.error(
                    `[${SCRIPT_NAME}] Cleaner error:`,
                    error
                );
            } finally {
                cleanButton.disabled = false;
            }
        });
    }

    function isCandidateNode(node) {
        return (
            Array.isArray(node?.connectedSegmentIds) &&
            node.connectedSegmentIds.length === 2 &&
            node.connectedSegmentIds[0] !== node.connectedSegmentIds[1]
        );
    }

    async function createHighlightLayer() {
        await wmeSDK.Map.addLayer({
            layerName: LAYER_NAME,
            styleRules: [
                {
                    style: {
                        fillColor: HIGHLIGHT_COLOR,
                        fillOpacity: 1,
                        strokeColor: "#FFFFFF",
                        strokeOpacity: 1,
                        strokeWidth: 1.5,
                        pointRadius: HIGHLIGHT_RADIUS,
                        pointerEvents: "none"
                    }
                }
            ]
        });
    }

    function createNodeFeatures(nodes) {
        const features = [];

        for (const node of nodes) {
            if (!isCandidateNode(node) || !node.geometry) {
                continue;
            }

            features.push({
                id: `node-${node.id}`,
                type: "Feature",
                geometry: node.geometry,
                properties: {
                    nodeId: node.id,
                    connectedSegmentIds: node.connectedSegmentIds
                }
            });
        }

        return features;
    }

    async function refreshHighlights() {
        if (isRefreshing) {
            pendingRefresh = true;
            return;
        }

        isRefreshing = true;

        try {
            const nodes =
                  await wmeSDK.DataModel.Nodes.getAll();

            const features = createNodeFeatures(nodes);

            await wmeSDK.Map.removeAllFeaturesFromLayer({
                layerName: LAYER_NAME
            });

            if (features.length > 0) {
                await wmeSDK.Map.addFeaturesToLayer({
                    layerName: LAYER_NAME,
                    features
                });
            }

        } catch (error) {
            console.error(
                `[${SCRIPT_NAME}] Highlight error:`,
                error
            );
        } finally {
            isRefreshing = false;

            if (pendingRefresh) {
                pendingRefresh = false;
                void refreshHighlights();
            }
        }
    }

    function areSegmentsCompatible(segmentA, segmentB) {
        if (!segmentA || !segmentB) {
            return false;
        }

        const attributes = [
            "roadType",
            "primaryStreetId",
            "elevationLevel",
            "lockRank",
            "routingRoadType",
            "allowNoDirection",
            "hasSeparator"
        ];

        const sameAttributes = attributes.every(
            attribute =>
            segmentA[attribute] === segmentB[attribute]
        );

        if (!sameAttributes) {
            return false;
        }

        // Initially, only two-way segments.
        if (!segmentA.isTwoWay || !segmentB.isTwoWay) {
            return false;
        }

        // Avoid direction-dependent speed differences.
        const speeds = [
            segmentA.fwdSpeedLimit,
            segmentA.revSpeedLimit,
            segmentB.fwdSpeedLimit,
            segmentB.revSpeedLimit
        ];

        if (!speeds.every(speed => speed === speeds[0])) {
            return false;
        }

        // Avoid segments with special attributes.
        const hasSpecialAttributes = segment =>
        segment.hasClosures ||
              segment.hasRestrictions ||
              segment.hasHouseNumbers ||
              segment.junctionId != null ||
              segment.fromNodeLanesCount > 0 ||
              segment.toNodeLanesCount > 0 ||
              segment.fromLanesInfo != null ||
              segment.toLanesInfo != null;

        if (
            hasSpecialAttributes(segmentA) ||
            hasSpecialAttributes(segmentB)
        ) {
            return false;
        }

        const streetsA = [...segmentA.alternateStreetIds]
        .sort((a, b) => a - b);

        const streetsB = [...segmentB.alternateStreetIds]
        .sort((a, b) => a - b);

        if (JSON.stringify(streetsA) !== JSON.stringify(streetsB)) {
            return false;
        }

        return JSON.stringify(segmentA.flagAttributes) ===
            JSON.stringify(segmentB.flagAttributes);
    }

    async function canRemoveJunction(node, segmentA, segmentB) {
        if (!isCandidateNode(node)) {
            return false;
        }

        if (!areSegmentsCompatible(segmentA, segmentB)) {
            return false;
        }

        const { Nodes, Segments, Turns } = wmeSDK.DataModel;

        const nodeId = node.id;

        if (!(await Nodes.canEdit({ nodeId }))) {
            return false;
        }

        if (await Nodes.isVirtual({ nodeId })) {
            return false;
        }

        for (const segment of [segmentA, segmentB]) {
            const segmentId = segment.id;

            if (await Segments.connectsToBigJunction({ segmentId })) {
                return false;
            }

            const virtualNodes =
                  await Segments.getVirtualNodes({ segmentId });

            if (virtualNodes.length > 0) {
                return false;
            }

            if (await Segments.isTollSegment({ segmentId })) {
                return false;
            }
        }

        const turns = await Turns.getTurnsThroughNode({ nodeId });

        const hasSpecialTurns = turns.some(turn =>
                                           turn.restrictions?.length > 0 ||
                                           turn.hasTurnGuidance ||
                                           turn.hasCustomTTS ||
                                           turn.hasVisualInstruction ||
                                           turn.hasShieldsPopulated ||
                                           turn.hasTowardsGuidance ||
                                           turn.instructionOpCode != null ||
                                           turn.isPathTurn ||
                                           turn.isJunctionBoxTurn ||
                                           turn.lanes != null ||
                                           (turn.isUTurn && turn.isAllowed)
                                          );

        if (hasSpecialTurns) {
            return false;
        }

        // Traffic must be allowed in both directions.
        const forwardAllowed = await Turns.isTurnAllowed({
            nodeId,
            fromSegmentId: segmentA.id,
            toSegmentId: segmentB.id
        });

        const reverseAllowed = await Turns.isTurnAllowed({
            nodeId,
            fromSegmentId: segmentB.id,
            toSegmentId: segmentA.id
        });

        return forwardAllowed && reverseAllowed;
    }

    async function cleanSelectedSegment() {
        if (isCleaning) {
            return "A cleaning operation is already running.";
        }

        isCleaning = true;

        try {
            return await cleanSelectedSegmentInternal();
        } finally {
            isCleaning = false;
        }
    }

    async function cleanSelectedSegmentInternal() {
        const selection = await wmeSDK.Editing.getSelection();

        if (
            !selection ||
            selection.objectType !== "segment" ||
            selection.ids.length !== 1
        ) {
            return "Please select a single segment.";
        }

        if (!(await wmeSDK.Editing.isEditingAllowed())) {
            return "Editing is not allowed.";
        }

        const segmentId = selection.ids[0];

        const chain = await findMergeChain(segmentId);

        if (chain.nodeIds.length === 0) {
            return "No removable junctions found.";
        }

        const confirmed = window.confirm(
            `Merge ${chain.segmentIds.length} segments?\n\n` +
            `${chain.nodeIds.length} junction nodes will be removed.\n\n` +
            `Segments: ${chain.segmentIds.join(", ")}\n\n` +
            `Review changes before saving.`
        );

        if (!confirmed) {
            return "Operation cancelled.";
        }

        // Revalidate the chain before editing.
        const currentChain = await findMergeChain(segmentId);

        if (
            JSON.stringify(chain) !==
            JSON.stringify(currentChain)
        ) {
            return "The segment chain has changed. Try again.";
        }

        let result;

        try {
            result = await mergeJunctionChain(
                currentChain.nodeIds
            );
        } finally {
            await refreshHighlights();
        }

        if (result.failedNodeId !== null) {
            return (
                `Merge stopped. ` +
                `${result.removed}/${currentChain.nodeIds.length} junctions removed. ` +
                `Failed node: ${result.failedNodeId}. ` +
                `Review changes before saving.`
            );
        }

        return (
            `Merge completed. ` +
            `${result.removed} junctions removed. ` +
            `Review changes before saving.`
        );
    }

    async function mergeJunctionChain(nodeIds) {
        let removed = 0;

        for (const nodeId of nodeIds) {
            try {
                await mergeJunctionNode(nodeId);
                removed++;
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Failed junction ${nodeId}:`, error);
                return { removed, failedNodeId: nodeId };
            }
        }

        return { removed, failedNodeId: null };
    }

    async function mergeJunctionNode(nodeId) {
        const { Nodes, Segments } = wmeSDK.DataModel;

        const node = await Nodes.getById({ nodeId });

        if (!node || !isCandidateNode(node)) {
            throw new Error(
                `Node ${nodeId} is no longer a valid candidate.`
            );
        }

        const [segmentAId, segmentBId] =
              node.connectedSegmentIds;

        const [segmentA, segmentB] = await Promise.all([
            Segments.getById({ segmentId: segmentAId }),
            Segments.getById({ segmentId: segmentBId })
        ]);

        const canRemove = await canRemoveJunction(
            node,
            segmentA,
            segmentB
        );

        if (!canRemove) {
            throw new Error(
                `Node ${nodeId} cannot be safely removed.`
        );
        }

        await Segments.mergeSegments({
            segmentIds: [segmentAId, segmentBId]
        });

    }

    async function findMergeChain(segmentId) {
        const { Segments, Nodes } = wmeSDK.DataModel;

        const initialSegment = await Segments.getById({
            segmentId
        });

        if (!initialSegment) {
            return {
                segmentIds: [],
                nodeIds: []
            };
        }

        const visited = new Set([segmentId]);

        const segmentIds = [segmentId];
        const nodeIds = [];

        async function walk(startNodeId, prepend = false) {
            let currentSegment = initialSegment;
            let currentNodeId = startNodeId;

            while (currentNodeId != null) {
                const node = await Nodes.getById({
                    nodeId: currentNodeId
                });

                if (!node || !isCandidateNode(node)) {
                    break;
                }

                if (!node.connectedSegmentIds.includes(currentSegment.id)) {
                    break;
                }

                const nextSegmentId = node.connectedSegmentIds.find(
                    id => id !== currentSegment.id
                );

                if (nextSegmentId == null) {
                    break;
                }

                // Prevent circular chains.
                if (visited.has(nextSegmentId)) {
                    throw new Error("Circular segment chain detected.");
                }

                const nextSegment = await Segments.getById({
                    segmentId: nextSegmentId
                });

                if (!nextSegment) {
                    break;
                }

                const isFrom = nextSegment.fromNodeId === currentNodeId;
                const isTo = nextSegment.toNodeId === currentNodeId;

                if (isFrom === isTo) {
                    break;
                }

                const canRemove = await canRemoveJunction(
                    node,
                    currentSegment,
                    nextSegment
                );

                if (!canRemove) {
                    break;
                }

                visited.add(nextSegmentId);

                if (prepend) {
                    segmentIds.unshift(nextSegmentId);
                    nodeIds.unshift(node.id);
                } else {
                    segmentIds.push(nextSegmentId);
                    nodeIds.push(node.id);
                }

                currentNodeId = isFrom
                    ? nextSegment.toNodeId
                : nextSegment.fromNodeId;

                currentSegment = nextSegment;
            }
        }

        // Walk from both ends of the selected segment.
        await walk(initialSegment.fromNodeId, true);
        await walk(initialSegment.toNodeId);

        return {
            segmentIds,
            nodeIds
        };
    }

    initialize().catch(error => {
        console.error(`[${SCRIPT_NAME}] Initialization error:`, error);
    });

    function injectFloatingStyles() {
        const style = document.createElement("style");

        style.textContent = `
        #${FLOATING_BUTTON_ID} {
            position: fixed;
            bottom: 80px;
            right: 20px;
            z-index: 10000;
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 5px;
            background: #1e293b;
            border: 1px solid #475569;
            border-radius: 8px;
            box-shadow: 0 3px 12px rgba(0, 0, 0, .3);
            user-select: none;
        }

        #${FLOATING_BUTTON_ID} .jc-drag-handle {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 32px;
            color: #94a3b8;
            font-size: 20px;
            cursor: grab;
            touch-action: none;
        }

        #${FLOATING_BUTTON_ID} .jc-drag-handle:active {
            cursor: grabbing;
        }

        #${FLOATING_BUTTON_ID} .jc-clean-button {
            padding: 8px 12px;
            border: none;
            border-radius: 5px;
            background: #2563eb;
            color: #fff;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            white-space: nowrap;
            transition: background .2s;
        }

        #${FLOATING_BUTTON_ID} .jc-clean-button:hover {
            background: #1d4ed8;
        }

        #${FLOATING_BUTTON_ID} .jc-clean-button:disabled {
            opacity: .5;
            cursor: not-allowed;
        }

        #${FLOATING_BUTTON_ID} .jc-floating-status {
            position: absolute;
            bottom: calc(100% + 8px);
            right: 0;
            width: 220px;
            padding: 10px;
            background: #1e293b;
            color: #fff;
            border-radius: 6px;
            font-size: 12px;
            line-height: 1.5;
            box-shadow: 0 3px 12px rgba(0, 0, 0, .3);
        }

        #${FLOATING_BUTTON_ID} .jc-floating-status[hidden] {
            display: none;
        }
    `;

        document.head.appendChild(style);
    }

    function makeDraggable(element, handle) {
        let offsetX = 0;
        let offsetY = 0;
        let activePointer = null;

        function setPosition(x, y) {
            const maxX = Math.max(
                0,
                window.innerWidth - element.offsetWidth
            );

            const maxY = Math.max(
                0,
                window.innerHeight - element.offsetHeight
            );

            element.style.left =
                `${Math.max(0, Math.min(x, maxX))}px`;

            element.style.top =
                `${Math.max(0, Math.min(y, maxY))}px`;

            element.style.right = "auto";
            element.style.bottom = "auto";
        }

        function savePosition() {
            const { left, top } =
                  element.getBoundingClientRect();

            localStorage.setItem(
                FLOATING_POSITION_KEY,
                JSON.stringify({ x: left, y: top })
            );
        }

        function restorePosition() {
            try {
                const saved = JSON.parse(
                    localStorage.getItem(FLOATING_POSITION_KEY)
                );

                if (
                    saved &&
                    Number.isFinite(saved.x) &&
                    Number.isFinite(saved.y)
                ) {
                    setPosition(saved.x, saved.y);
                }
            } catch {
                localStorage.removeItem(FLOATING_POSITION_KEY);
            }
        }

        handle.addEventListener("pointerdown", event => {
            if (event.button !== 0 || activePointer !== null) {
                return;
            }

            const rect = element.getBoundingClientRect();

            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;

            activePointer = event.pointerId;

            handle.setPointerCapture(event.pointerId);

            event.preventDefault();
            event.stopPropagation();
        });

        handle.addEventListener("pointermove", event => {
            if (event.pointerId !== activePointer) {
                return;
            }

            setPosition(
                event.clientX - offsetX,
                event.clientY - offsetY
            );
        });

        function stopDragging(event) {
            if (event.pointerId !== activePointer) {
                return;
            }

            activePointer = null;
            savePosition();
        }

        handle.addEventListener("pointerup", stopDragging);
        handle.addEventListener("pointercancel", stopDragging);
        handle.addEventListener("lostpointercapture", stopDragging);

        window.addEventListener("resize", () => {
            const rect = element.getBoundingClientRect();

            setPosition(rect.left, rect.top);
            savePosition();
        });

        restorePosition();
    }

    function initializeFloatingButton() {
        if (document.getElementById(FLOATING_BUTTON_ID)) {
            return;
        }

        injectFloatingStyles();

        const container = document.createElement("div");

        container.id = FLOATING_BUTTON_ID;

        container.innerHTML = `
        <div
            class="jc-drag-handle"
            title="Drag to move"
        >
            ⠿
        </div>

        <button
            type="button"
            class="jc-clean-button"
            title="Remove redundant junction nodes"
        >
            Clean Junctions
        </button>

        <div
            class="jc-floating-status"
            role="status"
            hidden
        ></div>
    `;

        document.body.appendChild(container);

        const handle = container.querySelector(".jc-drag-handle");
        const button = container.querySelector(".jc-clean-button");
        const status = container.querySelector(".jc-floating-status");

        let statusTimeout;

        function showStatus(message, duration = 5000) {
            clearTimeout(statusTimeout);

            status.textContent = message;
            status.hidden = false;

            if (duration > 0) {
                statusTimeout = setTimeout(() => {
                    status.hidden = true;
                }, duration);
            }
        }

        button.addEventListener("click", async () => {
            button.disabled = true;
            button.textContent = "Cleaning...";

            showStatus("Analyzing segments...", 0);

            try {
                const result = await cleanSelectedSegment();

                showStatus(result);

            } catch (error) {
                showStatus(`Error: ${error.message}`);

                console.error(
                    `[${SCRIPT_NAME}] Cleaner error:`,
                    error
                );
            } finally {
                button.disabled = false;
                button.textContent = "Clean Junctions";
            }
        });

        makeDraggable(container, handle);
    }
})();
