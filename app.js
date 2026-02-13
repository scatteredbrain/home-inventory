(function () {
    "use strict";

    // ── Data Layer ──────────────────────────────────────────────
    // Structure:
    //   rooms: [ { id, name, parentId (null for top-level), containers: [ { id, name, parentId (null for top-level in room), roomId, items: [ { id, name } ], children: [] } ] , children: [] } ]
    //
    // We store a flat list and reconstruct trees as needed.

    const STORAGE_KEY = "home_inventory_data";

    let data = loadData();

    function loadData() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (_) {}
        return { rooms: [], containers: [], items: [] };
    }

    function save() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    function genId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    // ── Room helpers ────────────────────────────────────────────
    function addRoom(name, parentId) {
        const room = { id: genId(), name, parentId: parentId || null };
        data.rooms.push(room);
        save();
        return room;
    }

    function getRoom(id) {
        return data.rooms.find(r => r.id === id);
    }

    function getChildRooms(parentId) {
        return data.rooms.filter(r => r.parentId === (parentId || null));
    }

    function getTopLevelRooms() {
        return data.rooms.filter(r => r.parentId === null);
    }

    function renameRoom(id, newName) {
        const room = getRoom(id);
        if (room) { room.name = newName; save(); }
    }

    function deleteRoom(id) {
        // Recursively delete sub-rooms, their containers, and items
        const children = getChildRooms(id);
        children.forEach(c => deleteRoom(c.id));
        // Delete containers in this room
        const containers = getContainersInRoom(id);
        containers.forEach(c => deleteContainerCascade(c.id));
        data.rooms = data.rooms.filter(r => r.id !== id);
        save();
    }

    function getRoomAncestors(roomId) {
        const path = [];
        let current = getRoom(roomId);
        while (current) {
            path.unshift(current);
            current = current.parentId ? getRoom(current.parentId) : null;
        }
        return path;
    }

    // ── Container helpers ───────────────────────────────────────
    function addContainer(name, roomId, parentContainerId) {
        const container = { id: genId(), name, roomId, parentId: parentContainerId || null };
        data.containers.push(container);
        save();
        return container;
    }

    function getContainer(id) {
        return data.containers.find(c => c.id === id);
    }

    function getContainersInRoom(roomId) {
        return data.containers.filter(c => c.roomId === roomId && c.parentId === null);
    }

    function getChildContainers(parentContainerId) {
        return data.containers.filter(c => c.parentId === parentContainerId);
    }

    function renameContainer(id, newName) {
        const c = getContainer(id);
        if (c) { c.name = newName; save(); }
    }

    function deleteContainerCascade(id) {
        // Delete child containers recursively
        const children = getChildContainers(id);
        children.forEach(c => deleteContainerCascade(c.id));
        // Delete items in this container
        data.items = data.items.filter(i => i.containerId !== id);
        data.containers = data.containers.filter(c => c.id !== id);
        save();
    }

    function getContainerAncestors(containerId) {
        const path = [];
        let current = getContainer(containerId);
        while (current) {
            path.unshift(current);
            current = current.parentId ? getContainer(current.parentId) : null;
        }
        return path;
    }

    // ── Item helpers ────────────────────────────────────────────
    function addItem(name, containerId) {
        const item = { id: genId(), name, containerId };
        data.items.push(item);
        save();
        return item;
    }

    function getItemsInContainer(containerId) {
        return data.items.filter(i => i.containerId === containerId);
    }

    function renameItem(id, newName) {
        const item = data.items.find(i => i.id === id);
        if (item) { item.name = newName; save(); }
    }

    function deleteItem(id) {
        data.items = data.items.filter(i => i.id !== id);
        save();
    }

    // ── Search ──────────────────────────────────────────────────
    function searchItems(query) {
        const q = query.toLowerCase().trim();
        if (!q) return [];
        return data.items.filter(i => i.name.toLowerCase().includes(q)).map(item => {
            const container = getContainer(item.containerId);
            if (!container) return null;
            const containerPath = getContainerAncestors(item.containerId).map(c => c.name);
            const roomPath = getRoomAncestors(container.roomId).map(r => r.name);
            return {
                item,
                containerId: item.containerId,
                roomId: container.roomId,
                locationText: roomPath.join(" > ") + " > " + containerPath.join(" > ")
            };
        }).filter(Boolean);
    }

    // ── UI State ────────────────────────────────────────────────
    let currentView = "welcome"; // "welcome" | "room" | "container"
    let currentRoomId = null;
    let currentContainerId = null;

    // DOM references
    const $ = id => document.getElementById(id);

    const roomTree = $("room-tree");
    const welcomeMsg = $("welcome-msg");
    const roomView = $("room-view");
    const containerView = $("container-view");
    const searchResults = $("search-results");
    const searchResultsList = $("search-results-list");

    // ── Modal ───────────────────────────────────────────────────
    function showModal(title, placeholder, defaultValue) {
        return new Promise((resolve) => {
            $("modal-title").textContent = title;
            $("modal-input").placeholder = placeholder || "";
            $("modal-input").value = defaultValue || "";
            $("modal-overlay").classList.remove("hidden");
            $("modal-input").focus();

            function cleanup() {
                $("modal-overlay").classList.add("hidden");
                $("modal-confirm").removeEventListener("click", onConfirm);
                $("modal-cancel").removeEventListener("click", onCancel);
                $("modal-input").removeEventListener("keydown", onKey);
            }

            function onConfirm() {
                const val = $("modal-input").value.trim();
                cleanup();
                resolve(val || null);
            }

            function onCancel() {
                cleanup();
                resolve(null);
            }

            function onKey(e) {
                if (e.key === "Enter") onConfirm();
                if (e.key === "Escape") onCancel();
            }

            $("modal-confirm").addEventListener("click", onConfirm);
            $("modal-cancel").addEventListener("click", onCancel);
            $("modal-input").addEventListener("keydown", onKey);
        });
    }

    // ── Sidebar Tree Rendering ──────────────────────────────────
    function renderSidebar() {
        roomTree.innerHTML = "";
        const topRooms = getTopLevelRooms();
        topRooms.forEach(room => {
            roomTree.appendChild(buildRoomTreeNode(room));
        });
    }

    function buildRoomTreeNode(room) {
        const li = document.createElement("li");

        const div = document.createElement("div");
        div.className = "tree-item" + (currentView === "room" && currentRoomId === room.id ? " active" : "");
        div.innerHTML = `<span class="tree-icon">&#9679;</span> ${escHtml(room.name)}`;
        div.addEventListener("click", () => navigateToRoom(room.id));
        li.appendChild(div);

        const children = getChildRooms(room.id);
        if (children.length > 0) {
            const ul = document.createElement("ul");
            ul.className = "tree-children";
            children.forEach(child => {
                ul.appendChild(buildRoomTreeNode(child));
            });
            li.appendChild(ul);
        }
        return li;
    }

    // ── Room View ───────────────────────────────────────────────
    function navigateToRoom(roomId) {
        currentView = "room";
        currentRoomId = roomId;
        currentContainerId = null;

        welcomeMsg.classList.add("hidden");
        containerView.classList.add("hidden");
        roomView.classList.remove("hidden");
        searchResults.classList.add("hidden");

        renderRoomView();
        renderSidebar();
    }

    function renderRoomView() {
        const room = getRoom(currentRoomId);
        if (!room) return;

        // Breadcrumb
        const ancestors = getRoomAncestors(currentRoomId);
        $("breadcrumb").innerHTML = ancestors.map((r, i) => {
            if (i === ancestors.length - 1) return `<span class="current">${escHtml(r.name)}</span>`;
            return `<span data-room-id="${r.id}">${escHtml(r.name)}</span>`;
        }).join(" &rsaquo; ");

        $("breadcrumb").querySelectorAll("span[data-room-id]").forEach(el => {
            el.addEventListener("click", () => navigateToRoom(el.dataset.roomId));
        });

        $("room-name-display").textContent = room.name;

        // Sub-rooms
        const subrooms = getChildRooms(currentRoomId);
        const subroomsList = $("subrooms-list");
        subroomsList.innerHTML = "";
        $("no-subrooms").classList.toggle("hidden", subrooms.length > 0);
        subrooms.forEach(sr => {
            const childCount = getChildRooms(sr.id).length;
            const containerCount = getContainersInRoom(sr.id).length;
            const card = document.createElement("div");
            card.className = "card";
            card.innerHTML = `<div class="card-icon">&#127968;</div><div class="card-label">${escHtml(sr.name)}</div><div class="card-count">${childCount} sub-rooms, ${containerCount} containers</div>`;
            card.addEventListener("click", () => navigateToRoom(sr.id));
            subroomsList.appendChild(card);
        });

        // Containers
        const containers = getContainersInRoom(currentRoomId);
        const containersList = $("containers-list");
        containersList.innerHTML = "";
        $("no-containers").classList.toggle("hidden", containers.length > 0);
        containers.forEach(c => {
            const childCount = getChildContainers(c.id).length;
            const itemCount = getItemsInContainer(c.id).length;
            const card = document.createElement("div");
            card.className = "card";
            card.innerHTML = `<div class="card-icon">&#128230;</div><div class="card-label">${escHtml(c.name)}</div><div class="card-count">${childCount} sub-containers, ${itemCount} items</div>`;
            card.addEventListener("click", () => navigateToContainer(c.id));
            containersList.appendChild(card);
        });
    }

    // ── Container View ──────────────────────────────────────────
    function navigateToContainer(containerId) {
        currentView = "container";
        currentContainerId = containerId;

        welcomeMsg.classList.add("hidden");
        roomView.classList.add("hidden");
        containerView.classList.remove("hidden");
        searchResults.classList.add("hidden");

        const container = getContainer(containerId);
        if (container) currentRoomId = container.roomId;

        renderContainerView();
        renderSidebar();
    }

    function renderContainerView() {
        const container = getContainer(currentContainerId);
        if (!container) return;

        // Breadcrumb: Room path > Container path
        const roomPath = getRoomAncestors(container.roomId);
        const containerPath = getContainerAncestors(currentContainerId);

        let crumbs = roomPath.map(r => `<span data-room-id="${r.id}">${escHtml(r.name)}</span>`);
        crumbs = crumbs.concat(containerPath.map((c, i) => {
            if (i === containerPath.length - 1) return `<span class="current">${escHtml(c.name)}</span>`;
            return `<span data-container-id="${c.id}">${escHtml(c.name)}</span>`;
        }));

        $("container-breadcrumb").innerHTML = crumbs.join(" &rsaquo; ");
        $("container-breadcrumb").querySelectorAll("span[data-room-id]").forEach(el => {
            el.addEventListener("click", () => navigateToRoom(el.dataset.roomId));
        });
        $("container-breadcrumb").querySelectorAll("span[data-container-id]").forEach(el => {
            el.addEventListener("click", () => navigateToContainer(el.dataset.containerId));
        });

        $("container-name-display").textContent = container.name;

        // Sub-containers
        const subcontainers = getChildContainers(currentContainerId);
        const subList = $("subcontainers-list");
        subList.innerHTML = "";
        $("no-subcontainers").classList.toggle("hidden", subcontainers.length > 0);
        subcontainers.forEach(sc => {
            const childCount = getChildContainers(sc.id).length;
            const itemCount = getItemsInContainer(sc.id).length;
            const card = document.createElement("div");
            card.className = "card";
            card.innerHTML = `<div class="card-icon">&#128230;</div><div class="card-label">${escHtml(sc.name)}</div><div class="card-count">${childCount} sub-containers, ${itemCount} items</div>`;
            card.addEventListener("click", () => navigateToContainer(sc.id));
            subList.appendChild(card);
        });

        // Items
        const items = getItemsInContainer(currentContainerId);
        const itemsList = $("items-list");
        itemsList.innerHTML = "";
        $("no-items").classList.toggle("hidden", items.length > 0);
        items.forEach(item => {
            const row = document.createElement("div");
            row.className = "item-row";
            row.innerHTML = `
                <div class="item-info">
                    <span class="item-label">${escHtml(item.name)}</span>
                </div>
                <div class="item-actions">
                    <button class="btn-rename-item" data-id="${item.id}">Rename</button>
                    <button class="btn-delete-item" data-id="${item.id}">Delete</button>
                </div>`;
            itemsList.appendChild(row);
        });

        itemsList.querySelectorAll(".btn-rename-item").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const current = data.items.find(i => i.id === id);
                const newName = await showModal("Rename Item", "New name", current ? current.name : "");
                if (newName) { renameItem(id, newName); renderContainerView(); }
            });
        });

        itemsList.querySelectorAll(".btn-delete-item").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (confirm("Delete this item?")) {
                    deleteItem(btn.dataset.id);
                    renderContainerView();
                }
            });
        });
    }

    // ── Event Handlers ──────────────────────────────────────────
    $("add-room-btn").addEventListener("click", async () => {
        const name = await showModal("New Room", "Room name (e.g. Bedroom)");
        if (name) { addRoom(name, null); renderSidebar(); }
    });

    $("add-subroom-btn").addEventListener("click", async () => {
        const name = await showModal("New Sub-room", "Sub-room name (e.g. Walk-in Closet)");
        if (name && currentRoomId) { addRoom(name, currentRoomId); renderRoomView(); renderSidebar(); }
    });

    $("add-container-btn").addEventListener("click", async () => {
        const name = await showModal("New Container", "Container name (e.g. Dresser)");
        if (name && currentRoomId) { addContainer(name, currentRoomId, null); renderRoomView(); }
    });

    $("rename-room-btn").addEventListener("click", async () => {
        const room = getRoom(currentRoomId);
        if (!room) return;
        const newName = await showModal("Rename Room", "New name", room.name);
        if (newName) { renameRoom(currentRoomId, newName); renderRoomView(); renderSidebar(); }
    });

    $("delete-room-btn").addEventListener("click", () => {
        if (!currentRoomId) return;
        const room = getRoom(currentRoomId);
        if (confirm(`Delete "${room.name}" and everything inside it?`)) {
            const parentId = room.parentId;
            deleteRoom(currentRoomId);
            if (parentId) {
                navigateToRoom(parentId);
            } else {
                currentView = "welcome";
                currentRoomId = null;
                roomView.classList.add("hidden");
                welcomeMsg.classList.remove("hidden");
                renderSidebar();
            }
        }
    });

    $("add-subcontainer-btn").addEventListener("click", async () => {
        const container = getContainer(currentContainerId);
        if (!container) return;
        const name = await showModal("New Sub-container", "Name (e.g. Top Left Drawer)");
        if (name) { addContainer(name, container.roomId, currentContainerId); renderContainerView(); }
    });

    $("add-item-btn").addEventListener("click", async () => {
        if (!currentContainerId) return;
        const name = await showModal("Add Item", "Item name (e.g. Running Shoes)");
        if (name) { addItem(name, currentContainerId); renderContainerView(); }
    });

    $("rename-container-btn").addEventListener("click", async () => {
        const c = getContainer(currentContainerId);
        if (!c) return;
        const newName = await showModal("Rename Container", "New name", c.name);
        if (newName) { renameContainer(currentContainerId, newName); renderContainerView(); }
    });

    $("delete-container-btn").addEventListener("click", () => {
        if (!currentContainerId) return;
        const c = getContainer(currentContainerId);
        if (confirm(`Delete "${c.name}" and everything inside it?`)) {
            const parentId = c.parentId;
            const roomId = c.roomId;
            deleteContainerCascade(currentContainerId);
            if (parentId) {
                navigateToContainer(parentId);
            } else {
                navigateToRoom(roomId);
            }
        }
    });

    // Search
    function performSearch() {
        const query = $("search-input").value;
        const results = searchItems(query);
        searchResultsList.innerHTML = "";
        if (results.length === 0) {
            searchResultsList.innerHTML = `<p class="empty-msg">No items found matching "${escHtml(query)}".</p>`;
        } else {
            results.forEach(r => {
                const div = document.createElement("div");
                div.className = "search-result-item";
                div.innerHTML = `<div class="item-name">${escHtml(r.item.name)}</div><div class="item-path">${escHtml(r.locationText)}</div>`;
                div.addEventListener("click", () => {
                    searchResults.classList.add("hidden");
                    navigateToContainer(r.containerId);
                });
                searchResultsList.appendChild(div);
            });
        }
        searchResults.classList.remove("hidden");
    }

    $("search-btn").addEventListener("click", performSearch);
    $("search-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter") performSearch();
    });
    $("close-search").addEventListener("click", () => {
        searchResults.classList.add("hidden");
    });

    // ── Utility ─────────────────────────────────────────────────
    function escHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Init ────────────────────────────────────────────────────
    renderSidebar();
})();
