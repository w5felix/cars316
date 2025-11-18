// -------------------------------------------------------------
// ORBIT VISUALIZATION (ES MODULE VERSION)
// Morandi colors + natural drifting motion
// Background = light gray
// Sun text = large, planet text = smaller
// -------------------------------------------------------------

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const width = window.innerWidth;
const height = window.innerHeight;

// -------------------------------------------------------------
// BACKGROUND: VERY LIGHT GRAY
// -------------------------------------------------------------
d3.select("body").style("background", "#f5f5f5");

const svg = d3.select("#chart")
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .style("background", "#f5f5f5");   // ensure full matching background

const tooltip = d3.select("#tooltip");

// -------------------------------------------------------------
// MORANDI COLOR PALETTE
// -------------------------------------------------------------

const morandiPalette = [
    "#D8CFC4",
    "#C3B9A6",
    "#B7AFA3",
    "#A6A5A1",
    "#D0C8C1",
    "#CABEB4",
    "#B5B2AD",
    "#9F9E9A"
];

const sunColor = "#E8DDB5";  // soft, warm Morandi yellow

// -------------------------------------------------------------
// CONFIG
// -------------------------------------------------------------

const boroughs = ["BROOKLYN", "QUEENS", "MANHATTAN", "BRONX", "STATEN ISLAND"];
const center = { x: width / 2, y: height / 2 };
const orbitRadius = 360;

// natural motion function (slow)
function smoothNoise(t, offset) {
    return (
        Math.sin(t * 0.0004 + offset) * 0.7 +
        Math.sin(t * 0.0006 + offset * 1.7) * 0.5 +
        Math.sin(t * 0.0003 + offset * 2.3) * 0.3
    );
}

// -------------------------------------------------------------
// LOAD CSV
// -------------------------------------------------------------

d3.csv("../data/original/collisions_severity.csv").then(data => {

    data.forEach(d => {
        if (d.BOROUGH) d.BOROUGH = d.BOROUGH.trim().toUpperCase();
    });

    data = data.filter(d => boroughs.includes(d.BOROUGH));

    // -------------------------------------------------------------
    // BUILD NODES
    // -------------------------------------------------------------

    const nodes = [];

    // SUN
    nodes.push({
        id: "NEW YORK",
        type: "sun",
        r: 120,
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
            r: 70,
            color: morandiPalette[i % morandiPalette.length],
            noiseOffset: Math.random() * 10000
        });
    });

    // -------------------------------------------------------------
    // FORCE SIM
    // -------------------------------------------------------------

    const links = nodes
        .filter(n => n.type !== "sun")
        .map(n => ({ source: nodes[0], target: n }));

    const simulation = d3.forceSimulation(nodes)
        .force("center", d3.forceCenter(center.x, center.y))
        .force("collide", d3.forceCollide(d => d.r + 14))
        .force("link", d3.forceLink(links).strength(0.04))
        .alpha(0.2)
        .on("tick", ticked);

    // -------------------------------------------------------------
    // DRAW CIRCLES
    // -------------------------------------------------------------

    const circles = svg.selectAll("circle")
        .data(nodes)
        .enter()
        .append("circle")
        .attr("r", d => d.r)
        .attr("fill", d => d.color)
        .attr("stroke", "#eee8e0")       // soft Morandi outline
        .attr("stroke-width", 3)
        .call(
            d3.drag()
                .on("start", dragStart)
                .on("drag", dragMove)
                .on("end", dragEnd)
        )
        .on("mouseover", (e, d) => {
            tooltip.style("opacity", 1).html(d.id);
        })
        .on("mousemove", e => {
            tooltip.style("left", (e.pageX + 10) + "px")
                .style("top", (e.pageY + 10) + "px");
        })
        .on("mouseout", () => tooltip.style("opacity", 0));

    // -------------------------------------------------------------
    // LABELS (Sun large, planets smaller)
    // -------------------------------------------------------------

    const labels = svg.selectAll("text.label")
        .data(nodes)
        .enter()
        .append("text")
        .attr("class", "label")
        .attr("text-anchor", "middle")
        .attr("dy", ".35em")
        .style("pointer-events", "none")
        .style("fill", "#5c5c5c")   // dark gray (subtle, fits Morandi)
        .style("font-weight", "600")
        .style("font-size", d => d.type === "sun" ? "32px" : "20px")   // <-- smaller planets
        .text(d => d.type === "sun" ? "New York" : d.id);

    // -------------------------------------------------------------
    // NATURAL DRIFT MOTION
    // -------------------------------------------------------------

    function animateNatural() {
        const t = Date.now();

        nodes.forEach(n => {
            if (n.type === "borough" && !n.dragging) {

                const baseX = center.x + orbitRadius * Math.cos(n.baseAngle);
                const baseY = center.y + orbitRadius * Math.sin(n.baseAngle);

                const wobbleX = smoothNoise(t, n.noiseOffset) * 40;
                const wobbleY = smoothNoise(t, n.noiseOffset + 2000) * 40;

                n.x = baseX + wobbleX;
                n.y = baseY + wobbleY;
            }
        });

        ticked();
        requestAnimationFrame(animateNatural);
    }

    animateNatural();

    // -------------------------------------------------------------
    // DRAG INTERACTION
    // -------------------------------------------------------------

    function dragStart(event, d) {
        d.dragging = true;
        simulation.alphaTarget(0.3).restart();
    }

    function dragMove(event, d) {
        d.x = event.x;
        d.y = event.y;
    }

    function dragEnd(event, d) {
        d.dragging = false;
        simulation.alphaTarget(0);
    }

    // -------------------------------------------------------------
    // UPDATE POSITIONS
    // -------------------------------------------------------------

    function ticked() {
        circles.attr("cx", d => d.x).attr("cy", d => d.y);
        labels.attr("x", d => d.x).attr("y", d => d.y);
    }

});
