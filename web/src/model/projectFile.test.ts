import { describe, expect, it } from "vitest";
import { emptyProject } from "./defaults";
import { assetIdsOf, parseProjectFile, ProjectFileError, serializeProject } from "./projectFile";

describe("project file", () => {
  it("round-trips a project", async () => {
    const project = emptyProject("Round trip");
    const parsed = await parseProjectFile(await serializeProject(project));
    expect(parsed).toEqual(project);
  });

  it("rejects files that are not projects", async () => {
    await expect(parseProjectFile("not json")).rejects.toBeInstanceOf(ProjectFileError);
    await expect(parseProjectFile(JSON.stringify({ hello: 1 }))).rejects.toThrow(/not a JoyoFit Studio project/);
    const file = JSON.parse(await serializeProject(emptyProject()));
    file.project.version = 99;
    await expect(parseProjectFile(JSON.stringify(file))).rejects.toThrow(/version 99/);
    file.project.version = 1;
    file.project.elements = [{ nope: true }];
    await expect(parseProjectFile(JSON.stringify(file))).rejects.toThrow(/damaged/);
  });

  it("lists the assets a project uses", () => {
    const p = emptyProject();
    p.elements[0] = { ...p.elements[0]!, fill: { kind: "image", assetId: "photo", zoom: 1, offsetX: 0, offsetY: 0, dim: 0 } } as never;
    expect(assetIdsOf(p)).toEqual(["photo"]);
  });
});
