#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env.MIROFISH_BASE_URL ?? "http://localhost:5001";

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

interface FetchOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  isFormData?: boolean;
}

async function api<T = unknown>(
  path: string,
  opts: FetchOptions = {}
): Promise<T> {
  const { method = "GET", body, query } = opts;

  let url = `${BASE_URL}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {};
  let fetchBody: string | undefined;

  if (body && method !== "GET") {
    headers["Content-Type"] = "application/json";
    fetchBody = JSON.stringify(body);
  }

  const res = await fetch(url, { method, headers, body: fetchBody });
  const json = (await res.json()) as T;
  return json;
}

// Convenience: format JSON for MCP text content
function jsonText(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "mirofish-mcp-server",
  version: "1.0.0",
});

// ========================== HEALTH ==========================

server.registerTool(
  "mirofish_health_check",
  {
    title: "Health Check",
    description:
      "Check if the MiroFish backend is running and healthy. Returns service status.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const data = await api("/health");
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

// ========================== PROJECT MANAGEMENT ==========================

server.registerTool(
  "mirofish_list_projects",
  {
    title: "List Projects",
    description:
      "List all MiroFish projects. Each project contains seed documents and ontology definitions for simulation.",
    inputSchema: {
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .default(50)
        .describe("Maximum number of projects to return"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ limit }) => {
    const data = await api("/api/graph/project/list", {
      query: { limit },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_get_project",
  {
    title: "Get Project",
    description:
      "Get details of a specific MiroFish project by its ID, including ontology, files, status, and graph info.",
    inputSchema: {
      project_id: z.string().describe("The project ID (e.g. proj_xxxx)"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ project_id }) => {
    const data = await api(`/api/graph/project/${project_id}`);
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_delete_project",
  {
    title: "Delete Project",
    description: "Delete a MiroFish project and all its associated data.",
    inputSchema: {
      project_id: z.string().describe("The project ID to delete"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ project_id }) => {
    const data = await api(`/api/graph/project/${project_id}`, {
      method: "DELETE",
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_reset_project",
  {
    title: "Reset Project",
    description:
      "Reset a project's state so its knowledge graph can be rebuilt. Keeps the ontology but clears the graph.",
    inputSchema: {
      project_id: z.string().describe("The project ID to reset"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ project_id }) => {
    const data = await api(`/api/graph/project/${project_id}/reset`, {
      method: "POST",
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

// ========================== ONTOLOGY & GRAPH ==========================

server.registerTool(
  "mirofish_generate_ontology",
  {
    title: "Generate Ontology",
    description:
      "Upload seed documents and a simulation requirement to generate an ontology (entity types and edge types). This creates a new project. Accepts PDF/MD/TXT file URLs or paths. NOTE: This endpoint expects multipart/form-data with actual file uploads — use the simulation_requirement and project_name to describe the scenario, and provide document text directly.",
    inputSchema: {
      simulation_requirement: z
        .string()
        .describe(
          "Description of what you want to simulate / predict (required)"
        ),
      project_name: z
        .string()
        .default("Unnamed Project")
        .describe("Name for the new project"),
      additional_context: z
        .string()
        .optional()
        .describe("Extra context or instructions for ontology generation"),
      document_text: z
        .string()
        .optional()
        .describe(
          "If you cannot upload files, provide the raw document text here. The backend will need file uploads for the actual endpoint — this is a convenience description."
        ),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ simulation_requirement, project_name, additional_context }) => {
    // NOTE: The actual /ontology/generate endpoint requires multipart file upload.
    // From an MCP context we can only send JSON. We document this limitation.
    const data = await api("/api/graph/ontology/generate", {
      method: "POST",
      body: {
        simulation_requirement,
        project_name,
        additional_context,
      },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_build_graph",
  {
    title: "Build Knowledge Graph",
    description:
      "Build a knowledge graph from a project's documents and ontology using Zep. This is an async operation — returns a task_id to poll with mirofish_get_task.",
    inputSchema: {
      project_id: z
        .string()
        .describe("The project ID (must have ontology generated first)"),
      graph_name: z
        .string()
        .optional()
        .describe("Custom name for the graph"),
      chunk_size: z
        .number()
        .int()
        .default(500)
        .describe("Text chunk size for processing"),
      chunk_overlap: z
        .number()
        .int()
        .default(50)
        .describe("Overlap between text chunks"),
      force: z
        .boolean()
        .default(false)
        .describe("Force rebuild even if a graph is already building"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ project_id, graph_name, chunk_size, chunk_overlap, force }) => {
    const data = await api("/api/graph/build", {
      method: "POST",
      body: { project_id, graph_name, chunk_size, chunk_overlap, force },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_get_graph_data",
  {
    title: "Get Graph Data",
    description:
      "Retrieve the full knowledge graph data (nodes and edges) for a given graph ID.",
    inputSchema: {
      graph_id: z.string().describe("The graph ID (e.g. mirofish_xxxx)"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ graph_id }) => {
    const data = await api(`/api/graph/data/${graph_id}`);
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_delete_graph",
  {
    title: "Delete Graph",
    description: "Delete a Zep knowledge graph by its ID.",
    inputSchema: {
      graph_id: z.string().describe("The graph ID to delete"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ graph_id }) => {
    const data = await api(`/api/graph/delete/${graph_id}`, {
      method: "DELETE",
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

// ========================== TASKS ==========================

server.registerTool(
  "mirofish_get_task",
  {
    title: "Get Task Status",
    description:
      "Check the status and progress of an async task (graph building, simulation preparation, report generation, etc.).",
    inputSchema: {
      task_id: z.string().describe("The task ID to check"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ task_id }) => {
    const data = await api(`/api/graph/task/${task_id}`);
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_list_tasks",
  {
    title: "List Tasks",
    description: "List all background tasks and their statuses.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const data = await api("/api/graph/tasks");
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

// ========================== SIMULATION - ENTITIES ==========================

server.registerTool(
  "mirofish_get_entities",
  {
    title: "Get Graph Entities",
    description:
      "Get all filtered entities from a knowledge graph. Only returns nodes matching predefined entity types.",
    inputSchema: {
      graph_id: z.string().describe("The graph ID"),
      entity_types: z
        .string()
        .optional()
        .describe("Comma-separated entity types to filter (e.g. 'Student,PublicFigure')"),
      enrich: z
        .boolean()
        .default(true)
        .describe("Whether to include related edge information"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ graph_id, entity_types, enrich }) => {
    const data = await api(`/api/simulation/entities/${graph_id}`, {
      query: { entity_types, enrich },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_get_entity_detail",
  {
    title: "Get Entity Detail",
    description: "Get detailed information about a specific entity including its context and relationships.",
    inputSchema: {
      graph_id: z.string().describe("The graph ID"),
      entity_uuid: z.string().describe("The entity UUID"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ graph_id, entity_uuid }) => {
    const data = await api(
      `/api/simulation/entities/${graph_id}/${entity_uuid}`
    );
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_get_entities_by_type",
  {
    title: "Get Entities by Type",
    description: "Get all entities of a specific type from a knowledge graph.",
    inputSchema: {
      graph_id: z.string().describe("The graph ID"),
      entity_type: z.string().describe("The entity type (e.g. 'Student', 'PublicFigure')"),
      enrich: z
        .boolean()
        .default(true)
        .describe("Whether to include related edge information"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ graph_id, entity_type, enrich }) => {
    const data = await api(
      `/api/simulation/entities/${graph_id}/by-type/${entity_type}`,
      { query: { enrich } }
    );
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

// ========================== SIMULATION - LIFECYCLE ==========================

server.registerTool(
  "mirofish_create_simulation",
  {
    title: "Create Simulation",
    description:
      "Create a new multi-agent simulation from a project. Requires a completed knowledge graph.",
    inputSchema: {
      project_id: z.string().describe("The project ID"),
      graph_id: z
        .string()
        .optional()
        .describe("Graph ID (defaults to project's graph)"),
      enable_twitter: z
        .boolean()
        .default(true)
        .describe("Enable Twitter-style simulation platform"),
      enable_reddit: z
        .boolean()
        .default(true)
        .describe("Enable Reddit-style simulation platform"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ project_id, graph_id, enable_twitter, enable_reddit }) => {
    const data = await api("/api/simulation/create", {
      method: "POST",
      body: { project_id, graph_id, enable_twitter, enable_reddit },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_prepare_simulation",
  {
    title: "Prepare Simulation",
    description:
      "Prepare a simulation environment — reads entities from the graph, generates agent profiles via LLM, and creates simulation config. Async — returns task_id.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
      entity_types: z
        .array(z.string())
        .optional()
        .describe("Filter to specific entity types"),
      use_llm_for_profiles: z
        .boolean()
        .default(true)
        .describe("Use LLM to generate agent personality profiles"),
      parallel_profile_count: z
        .number()
        .int()
        .default(5)
        .describe("Number of profiles to generate in parallel"),
      force_regenerate: z
        .boolean()
        .default(false)
        .describe("Force regeneration even if already prepared"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({
    simulation_id,
    entity_types,
    use_llm_for_profiles,
    parallel_profile_count,
    force_regenerate,
  }) => {
    const data = await api("/api/simulation/prepare", {
      method: "POST",
      body: {
        simulation_id,
        entity_types,
        use_llm_for_profiles,
        parallel_profile_count,
        force_regenerate,
      },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_prepare_status",
  {
    title: "Get Preparation Status",
    description: "Check the progress of simulation preparation.",
    inputSchema: {
      task_id: z.string().optional().describe("Task ID from prepare call"),
      simulation_id: z
        .string()
        .optional()
        .describe("Simulation ID to check"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ task_id, simulation_id }) => {
    const data = await api("/api/simulation/prepare/status", {
      method: "POST",
      body: { task_id, simulation_id },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_start_simulation",
  {
    title: "Start Simulation",
    description:
      "Start running a prepared simulation. Agents will begin interacting in the simulated environment.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID to start"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ simulation_id }) => {
    const data = await api("/api/simulation/start", {
      method: "POST",
      body: { simulation_id },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_stop_simulation",
  {
    title: "Stop Simulation",
    description: "Stop a running simulation.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID to stop"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ simulation_id }) => {
    const data = await api("/api/simulation/stop", {
      method: "POST",
      body: { simulation_id },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

// ========================== SIMULATION - STATUS & DATA ==========================

server.registerTool(
  "mirofish_get_simulation",
  {
    title: "Get Simulation",
    description: "Get details and current status of a specific simulation.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ simulation_id }) => {
    const data = await api(`/api/simulation/${simulation_id}`);
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_list_simulations",
  {
    title: "List Simulations",
    description: "List all simulations, optionally filtered by project.",
    inputSchema: {
      project_id: z
        .string()
        .optional()
        .describe("Filter by project ID"),
      limit: z.number().int().min(1).max(200).default(50).describe("Max results"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ project_id, limit }) => {
    const data = await api("/api/simulation/list", {
      query: { project_id, limit },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_simulation_run_status",
  {
    title: "Get Simulation Run Status",
    description:
      "Get the real-time running status of a simulation including process state.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ simulation_id }) => {
    const data = await api(`/api/simulation/${simulation_id}/run-status`);
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_simulation_run_status_detail",
  {
    title: "Get Detailed Run Status",
    description:
      "Get detailed running status of a simulation including round progress and agent activity.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ simulation_id }) => {
    const data = await api(
      `/api/simulation/${simulation_id}/run-status/detail`
    );
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_get_simulation_profiles",
  {
    title: "Get Simulation Profiles",
    description: "Get the agent profiles generated for a simulation.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ simulation_id }) => {
    const data = await api(`/api/simulation/${simulation_id}/profiles`);
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_get_simulation_config",
  {
    title: "Get Simulation Config",
    description: "Get the simulation configuration parameters.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ simulation_id }) => {
    const data = await api(`/api/simulation/${simulation_id}/config`);
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

// ========================== SIMULATION - RESULTS ==========================

server.registerTool(
  "mirofish_get_simulation_actions",
  {
    title: "Get Simulation Actions",
    description:
      "Get the action log of a simulation — all agent actions taken during the run.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ simulation_id }) => {
    const data = await api(`/api/simulation/${simulation_id}/actions`);
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_get_simulation_timeline",
  {
    title: "Get Simulation Timeline",
    description: "Get a chronological timeline of events during the simulation.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ simulation_id }) => {
    const data = await api(`/api/simulation/${simulation_id}/timeline`);
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_get_agent_stats",
  {
    title: "Get Agent Statistics",
    description: "Get statistics about agent behavior during a simulation.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ simulation_id }) => {
    const data = await api(`/api/simulation/${simulation_id}/agent-stats`);
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_get_simulation_posts",
  {
    title: "Get Simulation Posts",
    description:
      "Get social media posts generated by agents during the simulation (Twitter/Reddit style).",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ simulation_id }) => {
    const data = await api(`/api/simulation/${simulation_id}/posts`);
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_get_simulation_comments",
  {
    title: "Get Simulation Comments",
    description:
      "Get comments/replies generated by agents during the simulation.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ simulation_id }) => {
    const data = await api(`/api/simulation/${simulation_id}/comments`);
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

// ========================== SIMULATION - INTERVIEW ==========================

server.registerTool(
  "mirofish_interview_agent",
  {
    title: "Interview Agent",
    description:
      "Interview (chat with) a specific simulated agent. The agent responds based on its personality, memories, and actions during the simulation.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
      agent_name: z.string().describe("Name of the agent to interview"),
      message: z.string().describe("Your question/message to the agent"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ simulation_id, agent_name, message }) => {
    const data = await api("/api/simulation/interview", {
      method: "POST",
      body: { simulation_id, agent_name, message },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_interview_batch",
  {
    title: "Batch Interview Agents",
    description:
      "Send the same question to multiple agents at once. Useful for gathering diverse perspectives.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
      agent_names: z
        .array(z.string())
        .describe("List of agent names to interview"),
      message: z.string().describe("The question to ask all agents"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ simulation_id, agent_names, message }) => {
    const data = await api("/api/simulation/interview/batch", {
      method: "POST",
      body: { simulation_id, agent_names, message },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_interview_all",
  {
    title: "Interview All Agents",
    description:
      "Send the same question to ALL agents in the simulation. Returns all their responses.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
      message: z.string().describe("The question to ask all agents"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ simulation_id, message }) => {
    const data = await api("/api/simulation/interview/all", {
      method: "POST",
      body: { simulation_id, message },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_interview_history",
  {
    title: "Get Interview History",
    description: "Get the conversation history for a specific agent interview.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
      agent_name: z.string().describe("Name of the agent"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ simulation_id, agent_name }) => {
    const data = await api("/api/simulation/interview/history", {
      method: "POST",
      body: { simulation_id, agent_name },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

// ========================== SIMULATION - ENVIRONMENT ==========================

server.registerTool(
  "mirofish_env_status",
  {
    title: "Get Environment Status",
    description: "Check the status of the simulation environment (OASIS engine).",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ simulation_id }) => {
    const data = await api("/api/simulation/env-status", {
      method: "POST",
      body: { simulation_id },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_close_env",
  {
    title: "Close Environment",
    description: "Close/shut down a simulation environment.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ simulation_id }) => {
    const data = await api("/api/simulation/close-env", {
      method: "POST",
      body: { simulation_id },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

// ========================== REPORTS ==========================

server.registerTool(
  "mirofish_generate_report",
  {
    title: "Generate Report",
    description:
      "Generate a prediction/analysis report from a completed simulation. Async — returns task_id to poll.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
      force_regenerate: z
        .boolean()
        .default(false)
        .describe("Force regeneration even if report already exists"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ simulation_id, force_regenerate }) => {
    const data = await api("/api/report/generate", {
      method: "POST",
      body: { simulation_id, force_regenerate },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_report_generate_status",
  {
    title: "Get Report Generation Status",
    description: "Check the progress of report generation.",
    inputSchema: {
      task_id: z.string().optional().describe("Task ID from generate call"),
      simulation_id: z
        .string()
        .optional()
        .describe("Simulation ID to check"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ task_id, simulation_id }) => {
    const data = await api("/api/report/generate/status", {
      method: "POST",
      body: { task_id, simulation_id },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_get_report",
  {
    title: "Get Report",
    description:
      "Get a completed report by its ID — includes outline, markdown content, and metadata.",
    inputSchema: {
      report_id: z.string().describe("The report ID"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ report_id }) => {
    const data = await api(`/api/report/${report_id}`);
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_get_report_by_simulation",
  {
    title: "Get Report by Simulation",
    description: "Get the report associated with a specific simulation.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ simulation_id }) => {
    const data = await api(`/api/report/by-simulation/${simulation_id}`);
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_list_reports",
  {
    title: "List Reports",
    description: "List all generated reports, optionally filtered by simulation.",
    inputSchema: {
      simulation_id: z
        .string()
        .optional()
        .describe("Filter by simulation ID"),
      limit: z.number().int().min(1).max(200).default(50).describe("Max results"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ simulation_id, limit }) => {
    const data = await api("/api/report/list", {
      query: { simulation_id, limit },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_delete_report",
  {
    title: "Delete Report",
    description: "Delete a generated report.",
    inputSchema: {
      report_id: z.string().describe("The report ID to delete"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ report_id }) => {
    const data = await api(`/api/report/${report_id}`, {
      method: "DELETE",
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_get_report_progress",
  {
    title: "Get Report Progress",
    description:
      "Get real-time progress of report generation including current section being written.",
    inputSchema: {
      report_id: z.string().describe("The report ID"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ report_id }) => {
    const data = await api(`/api/report/${report_id}/progress`);
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_get_report_sections",
  {
    title: "Get Report Sections",
    description:
      "Get all generated sections of a report. Can be polled during generation to get sections as they complete.",
    inputSchema: {
      report_id: z.string().describe("The report ID"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ report_id }) => {
    const data = await api(`/api/report/${report_id}/sections`);
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_get_report_section",
  {
    title: "Get Single Report Section",
    description: "Get the content of a specific section by index.",
    inputSchema: {
      report_id: z.string().describe("The report ID"),
      section_index: z
        .number()
        .int()
        .min(1)
        .describe("Section index (starting from 1)"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ report_id, section_index }) => {
    const data = await api(
      `/api/report/${report_id}/section/${section_index}`
    );
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_check_report_status",
  {
    title: "Check Report Status",
    description:
      "Check if a simulation has a report and its status. Used to determine if interview is unlocked.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ simulation_id }) => {
    const data = await api(`/api/report/check/${simulation_id}`);
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

// ========================== REPORT - CHAT ==========================

server.registerTool(
  "mirofish_chat_with_report_agent",
  {
    title: "Chat with Report Agent",
    description:
      "Have a conversation with the Report Agent about a simulation's results. The agent can search the knowledge graph and use tools to answer your questions.",
    inputSchema: {
      simulation_id: z.string().describe("The simulation ID"),
      message: z.string().describe("Your question or message"),
      chat_history: z
        .array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string(),
          })
        )
        .optional()
        .describe("Previous conversation history for context"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ simulation_id, message, chat_history }) => {
    const data = await api("/api/report/chat", {
      method: "POST",
      body: { simulation_id, message, chat_history },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

// ========================== REPORT - TOOLS (DEBUG) ==========================

server.registerTool(
  "mirofish_search_graph",
  {
    title: "Search Knowledge Graph",
    description:
      "Search the knowledge graph for facts and information. Uses Zep's semantic search.",
    inputSchema: {
      graph_id: z.string().describe("The graph ID to search"),
      query: z.string().describe("Search query"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Maximum results"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ graph_id, query, limit }) => {
    const data = await api("/api/report/tools/search", {
      method: "POST",
      body: { graph_id, query, limit },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

server.registerTool(
  "mirofish_graph_statistics",
  {
    title: "Get Graph Statistics",
    description:
      "Get statistics about a knowledge graph — node counts, edge counts, entity type distribution.",
    inputSchema: {
      graph_id: z.string().describe("The graph ID"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ graph_id }) => {
    const data = await api("/api/report/tools/statistics", {
      method: "POST",
      body: { graph_id },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

// ========================== SIMULATION - HISTORY ==========================

server.registerTool(
  "mirofish_simulation_history",
  {
    title: "Get Simulation History",
    description:
      "Get the history of all simulations with their run status and results.",
    inputSchema: {
      limit: z.number().int().min(1).max(200).default(50).describe("Max results"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ limit }) => {
    const data = await api("/api/simulation/history", {
      query: { limit },
    });
    return { content: [{ type: "text" as const, text: jsonText(data) }] };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MiroFish MCP server failed to start:", err);
  process.exit(1);
});
