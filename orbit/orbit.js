// -------------------------------------------------------------
// ORBIT VISUALIZATION (Sun + Planets)
// Morandi colors, natural drifting, STRAIGHT glowing lines,
// Planet sizes scale with accident counts,
// Smooth drag (no snapping)
// -------------------------------------------------------------

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const width = window.innerWidth;
const height = window.innerHeight;

// -------------------------------------------------------------
// BACKGROUND
// -------------------------------------------------------------
d3.select("body").style("background", "#f5f5f5");

const svg = d3.select("#chart")
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .style("background", "#f5f5f5");

const tooltip = d3.select("#tooltip");

// -------------------------------------------------------------
// GLOW FILTER FOR LINES
// -------------------------------------------------------------
const defs = svg.append("defs");

const glow = defs.append("filter")
    .attr("id", "soft-glow");

glow.append("feGaussianBlur")
    .attr("stdDeviation", "6")
    .attr("result", "coloredBlur");

const feMerge = glow.append("feMerge");
feMerge.append("feMergeNode").attr("in", "coloredBlur");
feMerge.append("feMergeNode").attr("in", "SourceGraphic");

// -------------------------------------------------------------
// MORANDI COLORS
// -------------------------------------------------------------
const morandiPalette = [
    "#D8CFC4", "#C3B9A6", "#B7AFA3", "#A6A5A1",
    "#D0C8C1", "#CABEB4", "#B5B2AD", "#9F9E9A"
];

const sunColor = "#EBDFAF";

// -------------------------------------------------------------
// CONFIG
// -------------------------------------------------------------
const boroughs = ["BROOKLYN", "QUEENS", "MANHATTAN", "BRONX", "STATEN ISLAND"];
const center = { x: width / 2, y: height / 2 };
const orbitRadius = 380;

// natural drift
function smoothNoise(t, offset) {
    return (
        Math.sin(t * 0.0004 + offset) * 0.7 +
        Math.sin(t * 0.0006 + offset * 1.7) * 0.5 +
        Math.sin(t * 0.0003 + offset * 2.3) * 0.3
    );
}

// -------------------------------------------------------------
// LOAD DATA
// -------------------------------------------------------------
d3.csv("../data/original/collisions_severity.csv").then(data => {

    // normalize
    data.forEach(d => {
        if (d.BOROUGH) d.BOROUGH = d.BOROUGH.trim().toUpperCase();
    });

    const filtered = data.filter(d => boroughs.includes(d.BOROUGH));

    // COUNT ACCIDENTS
    const boroughCounts = {};
    boroughs.forEach(b => boroughCounts[b] = 0);

    filtered.forEach(d => {
        boroughCounts[d.BOROUGH]++;
    });

    const countsArray = Object.values(boroughCounts);
    const minCount = Math.min(...countsArray);
    const maxCount = Math.max(...countsArray);

    const radiusScale = d3.scaleLinear()
        .domain([minCount, maxCount])
        .range([55, 115]); // always < sun

    // -------------------------------------------------------------
    // BUILD NODES
    // -------------------------------------------------------------
    const nodes = [];

    // SUN
    nodes.push({
        id: "NEW YORK",
        type: "sun",
        r: 140,
        fx: center.x,
        fy: center.y,
        color: sunColor
    });

    // PLANETS
    boroughs.forEach((b, i) => {
        const angle = (i / boroughs.length) * Math.PI * 2;
        nodes.push({
            id: b,
            type: "borough",
            baseAngle: angle,
            r: radiusScale(boroughCounts[b]),
            color: morandiPalette[i],
            noiseOffset: Math.random() * 10000
        });
    });

    // -------------------------------------------------------------
    // LINKS (SUN → PLANETS)
    // -------------------------------------------------------------
    const links = nodes
        .filter(n => n.type === "borough")
        .map(n => ({
            source: nodes[0],
            target: n
        }));

    const simulation = d3.forceSimulation(nodes)
        .force("center", d3.forceCenter(center.x, center.y))
        .force("collide", d3.forceCollide(d => d.r + 18))
        .force("link", d3.forceLink(links).strength(0.05))
        .alpha(0.25)
        .on("tick", ticked);

    // -------------------------------------------------------------
    // STRAIGHT GLOWING LINES
    // -------------------------------------------------------------
    const linkLines = svg.append("g")
        .selectAll("line")
        .data(links)
        .enter()
        .append("line")
        .attr("stroke", "#bfbab2")
        .attr("stroke-width", 2)
        .attr("opacity", 0.8)
        .attr("filter", "url(#soft-glow)");

    // -------------------------------------------------------------
    // DRAW SUN + PLANETS
    // -------------------------------------------------------------
    const circles = svg.append("g")
        .selectAll("circle")
        .data(nodes)
        .enter()
        .append("circle")
        .attr("r", d => d.r)
        .attr("fill", d => d.color)
        .attr("stroke", "#eee8e0")
        .attr("stroke-width", 3)
        .on("mouseover", (e, d) => tooltip.style("opacity", 1).html(d.id))
        .on("mousemove", e =>
            tooltip.style("left", (e.pageX + 12) + "px")
                .style("top", (e.pageY + 12) + "px")
        )
        .on("mouseout", () => tooltip.style("opacity", 0))
        .call(
            d3.drag()
                .on("start", dragStart)
                .on("drag", dragMove)
                .on("end", dragEnd)
        );

    // -------------------------------------------------------------
    // LABELS
    // -------------------------------------------------------------
    const labels = svg.append("g")
        .selectAll("text")
        .data(nodes)
        .enter()
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", ".35em")
        .style("pointer-events", "none")
        .style("fill", "#5c5c5c")
        .style("font-weight", "600")
        .style("font-size", d => d.type === "sun" ? "32px" : "20px")
        .text(d => d.type === "sun" ? "New York" : d.id);

    // -------------------------------------------------------------
    // NATURAL DRIFT + SMOOTH DRAG FIX
    // -------------------------------------------------------------
    function animateNatural() {
        const t = Date.now();

        nodes.forEach(n => {
            if (n.type === "borough") {

                if (n.dragging) {
                    // while dragging → DO NOT overwrite manual position
                    n.lastDraggedX = n.x;
                    n.lastDraggedY = n.y;
                    return;
                }

                // smooth glide back to orbit
                const baseX = center.x + orbitRadius * Math.cos(n.baseAngle);
                const baseY = center.y + orbitRadius * Math.sin(n.baseAngle);

                const wobbleX = smoothNoise(t, n.noiseOffset) * 40;
                const wobbleY = smoothNoise(t, n.noiseOffset + 2000) * 40;

                const targetX = baseX + wobbleX;
                const targetY = baseY + wobbleY;

                const ease = 0.04;  // controls natural smooth glide

                n.x += (targetX - n.x) * ease;
                n.y += (targetY - n.y) * ease;
            }
        });

        ticked();
        requestAnimationFrame(animateNatural);
    }

    animateNatural();

    // -------------------------------------------------------------
    // DRAGGING (smooth)
    // -------------------------------------------------------------
    function dragStart(event, d) {
        if (d.type === "borough") d.dragging = true;
        simulation.alphaTarget(0.3).restart();
    }

    function dragMove(event, d) {
        if (d.dragging) {
            d.x = event.x;
            d.y = event.y;
        }
    }

    function dragEnd(event, d) {
        d.dragging = false;
        simulation.alphaTarget(0);
    }

    // -------------------------------------------------------------
    // TICK UPDATE
    // -------------------------------------------------------------
    function ticked() {
        circles.attr("cx", d => d.x).attr("cy", d => d.y);

        labels.attr("x", d => d.x).attr("y", d => d.y);

        linkLines
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);
    }

});
