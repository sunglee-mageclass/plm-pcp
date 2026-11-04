import { describe, expect, it } from "vitest";
import { aplicarPatchCqRolo, baseCqRolos, cqRolosDirty, cqRolosDoPayload, type CqRoloCampos } from "@/components/oc-tecido/CqTecido";

const rolo = (o: Partial<CqRoloCampos> = {}): CqRoloCampos => ({ roloItemId: "r1", cq_ok: false, cq_alerta: false, cqStatus: "sem_alerta", obs: "", ...o });

describe("CQ por rolo existente (rascunho -> _cq_rolos)", () => {
  it("editar marca cq_tocado; voltar ao valor carregado desmarca", () => {
    const base = baseCqRolos({ a: [rolo()] }).r1;
    const e1 = aplicarPatchCqRolo(rolo(), { cq_ok: true }, base);
    expect(e1.cq_tocado).toBe(true);
    const e2 = aplicarPatchCqRolo(e1, { cq_ok: false }, base);
    expect(e2.cq_tocado).toBeUndefined();
  });

  it("alerta so alterna em sem_alerta/alertado; estado resolvido ignora o toggle", () => {
    const base = { cq_ok: false, cq_alerta: false, obs: "" };
    expect(aplicarPatchCqRolo(rolo(), { cq_alerta: true }, base).cq_alerta).toBe(true);
    const trocado = rolo({ cqStatus: "trocado" });
    const r = aplicarPatchCqRolo(trocado, { cq_alerta: true }, base);
    expect(r.cq_alerta).toBe(false);
    expect(r.cq_tocado).toBeUndefined();
  });

  it("payload: so rolo existente tocado; cq_alerta so quando mudou e e alternavel; obs vazia vai como string vazia", () => {
    const bases = { r1: { cq_ok: false, cq_alerta: false, obs: "x" }, r2: { cq_ok: false, cq_alerta: false, obs: "" } };
    const rolos = {
      a: [
        rolo({ cq_ok: true, cq_tocado: true, obs: "" }), // r1: mudou ok e apagou obs; alerta igual -> sem cq_alerta
        rolo({ roloItemId: "r2", cq_alerta: true, cq_tocado: true }), // r2: alerta mudou
        rolo({ roloItemId: "r3", cq_ok: true }), // nao tocado
        { cq_ok: true, cq_tocado: true }, // rolo NOVO (sem roloItemId) nunca entra
        rolo({ roloItemId: "r4", cq_alerta: true, cqStatus: "cancelado", cq_tocado: true }), // resolvido: sem cq_alerta
      ],
    };
    expect(cqRolosDoPayload(rolos, { ...bases, r4: { cq_ok: false, cq_alerta: false, obs: "" } })).toEqual([
      { item_id: "r1", cq_ok: true, cq_observacao: "" },
      { item_id: "r2", cq_ok: false, cq_alerta: true, cq_observacao: "" },
      { item_id: "r4", cq_ok: false, cq_observacao: "" },
    ]);
  });

  it("dirty: vazio sem tocados, ordenado por id com tocados", () => {
    expect(cqRolosDirty({ a: [rolo()] })).toEqual([]);
    const d = cqRolosDirty({ a: [rolo({ roloItemId: "b", cq_tocado: true }), rolo({ roloItemId: "a", cq_tocado: true, cq_ok: true })] });
    expect(d.map((x) => x.id)).toEqual(["a", "b"]);
  });
});
