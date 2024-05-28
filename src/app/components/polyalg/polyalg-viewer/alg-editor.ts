import {Injector, WritableSignal} from '@angular/core';
import {GetSchemes, NodeEditor} from 'rete';
import {AreaExtensions, AreaPlugin, BaseAreaPlugin} from 'rete-area-plugin';
import {ConnectionPlugin, Presets as ConnectionPresets} from 'rete-connection-plugin';
import {AngularArea2D, AngularPlugin, Presets} from 'rete-angular-plugin/17';
import {PlanNode} from '../models/polyalg-plan.model';
import {ArrangeAppliers, AutoArrangePlugin} from 'rete-auto-arrange-plugin';
import {AlgNode, AlgNodeComponent} from '../algnode/alg-node.component';
import {addCustomBackground} from './background';
import {ArgControl} from '../controls/arg-control';
import {CustomSocketComponent} from '../custom-socket/custom-socket.component';
import {CustomConnection, CustomConnectionComponent} from '../custom-connection/custom-connection.component';
import {ReadonlyPlugin} from 'rete-readonly-plugin';
import {ConnectionPathPlugin, Transformers} from 'rete-connection-path-plugin';
import {getDOMSocketPosition} from 'rete-render-utils';
import {ContextMenuExtra, ContextMenuPlugin, Presets as ContextMenuPresets} from 'rete-context-menu-plugin';
import {PolyAlgService} from '../polyalg.service';
import {DataModel} from '../../../models/ui-request.model';
import {DataflowEngine} from 'rete-engine';
import {Position} from 'rete-angular-plugin/17/types';
import {Subject} from 'rxjs';
import {canCreateConnection, findRootNodeId, getModelPrefix} from './alg-editor-utils';
import {setupPanningBoundary} from './panning-boundary';
import {useMagneticConnection} from './magnetic-connection';
import {MagneticConnectionComponent} from './magnetic-connection/magnetic-connection.component';
import {AlgMetadata} from '../algnode/alg-metadata/alg-metadata.component';
import {Transform} from 'rete-area-plugin/_types/area';
import {PlanType} from '../../../models/information-page.model';
import {OperatorTag} from '../models/polyalg-registry';

export type Schemes = GetSchemes<AlgNode, CustomConnection<AlgNode>>;
type AreaExtra = AngularArea2D<Schemes> | ContextMenuExtra;

export async function createEditor(container: HTMLElement, injector: Injector, registry: PolyAlgService, node: PlanNode | null,
                                   planType: PlanType, isReadOnly: boolean, userMode: WritableSignal<UserMode>,
                                   oldTransform: Transform | null) {

    const readonlyPlugin = new ReadonlyPlugin<Schemes>();

    //const socket = new ClassicPreset.Socket('socket');
    const editor = new NodeEditor<Schemes>();
    const area = new AreaPlugin<Schemes, AreaExtra>(container);
    const connection = new ConnectionPlugin<Schemes, AreaExtra>;
    const render = new AngularPlugin<Schemes, AreaExtra>({injector});
    const engine = new DataflowEngine<Schemes>();
    const arrange = new AutoArrangePlugin<Schemes>();
    const pathPlugin = new ConnectionPathPlugin({
        transformer: () => (
            (p) => Transformers.classic({vertical: true})(p.reverse()) // reverse for correct UP direction
        )
    });

    const selector = AreaExtensions.selector();
    AreaExtensions.selectableNodes(area, selector, {
        accumulating: AreaExtensions.accumulateOnCtrl()
    });

    render.addPreset(Presets.classic.setup<Schemes, AngularArea2D<Schemes>>({
        customize: {
            node() {
                return AlgNodeComponent;
            },
            control(data) {
                if (data.payload instanceof ArgControl) {
                    return data.payload.getArgComponent();
                }
                return null;
            },
            connection(data) {
                if (data.payload.isMagnetic) {
                    return MagneticConnectionComponent;
                }
                return CustomConnectionComponent;
            },
            socket() {
                return CustomSocketComponent;
            }
        },
        socketPositionWatcher: getDOMSocketPosition({
            offset({x, y}, nodeId, side, key) {
                return {x, y};
            },
        })
    }));
    render.addPreset(Presets.contextMenu.setup({delay: 100}));

    connection.addPreset(ConnectionPresets.classic.setup());

    const applier = new ArrangeAppliers.TransitionApplier<Schemes, never>({
        duration: 250,
        timingFunction: (t) => t,
        async onTick() {
            await AreaExtensions.zoomAt(area, editor.getNodes());
        }
    });
    arrange.addPreset(() => {
        return {
            port(n) {
                return {
                    x: n.width / (n.ports + 1) * (n.index + 1),
                    y: 0,
                    width: 15,
                    height: 15,
                    side: 'output' === n.side ? 'NORTH' : 'SOUTH'
                };
            }
        };
    });
    const layoutOpts = {
        'elk.direction': 'UP'
    };

    const $modifyEvent = new Subject<void>();
    const updateSizeFct = (a: AlgNode, delta: Position) => updateSize(a, delta, area, isReadOnly ? readonlyPlugin : null,
        () => arrange.layout({applier: undefined, options: layoutOpts}), $modifyEvent);

    const contextMenu = new ContextMenuPlugin<Schemes>({
        items: getContextMenuItems(registry, userMode, planType, isReadOnly, updateSizeFct)
    });

    editor.use(readonlyPlugin.root);
    editor.use(area);
    editor.use(engine);
    area.use(readonlyPlugin.area);
    area.use(render);
    area.use(arrange);
    render.use(pathPlugin);

    if (!isReadOnly) {
        area.use(connection);  // make connections editable
        area.use(contextMenu); // add context menu

        useMagneticConnection(connection, {
            async createConnection(from, to) {
                if (from.side === to.side) {
                    return;
                }
                const [source, target] = from.side === 'output' ? [from, to] : [to, from];
                const sourceNode = editor.getNode(source.nodeId);
                const targetNode = editor.getNode(target.nodeId);

                const connection = new CustomConnection(
                    sourceNode,
                    source.key as never,
                    targetNode,
                    target.key as never
                );

                if (!canCreateConnection(editor, connection)) {
                    return;
                }

                const connectionsToRemove = editor.getConnections().filter(c => {
                    return (c.target === targetNode.id && c.targetInput === target.key && !targetNode.hasVariableInputs) || (c.source === sourceNode.id);
                });

                for (const c of connectionsToRemove) {
                    await editor.removeConnection(c.id);
                }

                await editor.addConnection(
                    connection
                );
            },
            display(from, to) {
                return from.side !== to.side;
            },
            offset(socket, position) {

                return {
                    x: position.x + (socket.side === 'input' ? 3 : -3),
                    y: position.y + (socket.side === 'input' ? 12 : -12)
                };
            },
            distance: 75
        });
    }

    AreaExtensions.simpleNodesOrder(area);
    addCustomBackground(area);
    AreaExtensions.restrictor(area, {scaling: {min: 0.02, max: 5}});
    let panningBoundary = null;
    if (!isReadOnly) {
        panningBoundary = setupPanningBoundary({area, selector, padding: 40, intensity: 2});
    }

    const [nodes, connections] = addNode(registry, node, isReadOnly, updateSizeFct);
    for (const n of nodes) {
        await editor.addNode(n);
    }

    for (const c of connections) {
        await editor.addConnection(c);
    }

    await arrange.layout({
        applier: undefined, options: layoutOpts
    });

    if (oldTransform) {
        await area.area.zoom(oldTransform.k, oldTransform.x, oldTransform.y);
    } else {
        AreaExtensions.zoomAt(area, editor.getNodes());
    }

    const modifyingEventTypes = new Set(['nodecreated', 'noderemoved', 'connectioncreated', 'connectionremoved']);
    editor.addPipe(context => {
        if (context.type === 'connectioncreate') {
            if (!canCreateConnection(editor, context.data)) {
                //alert('Sockets are not compatible');
                return;
            }
        }
        if (modifyingEventTypes.has(context.type)) {
            if (!(context.type === 'nodecreated' || context.type === 'noderemoved') || editor.getNodes().length === 1) {
                $modifyEvent.next();
            }
        }
        return context;
    });
    area.addPipe(context => {
        if (context.type === 'zoom' && context.data.source === 'dblclick') {
            return; // https://github.com/retejs/rete/issues/204
        }
        return context;
    });

    if (isReadOnly) {
        readonlyPlugin.enable(); // disable interaction with nodes (control interaction is deactivated separately)
    }


    return {
        layout: async () => {
            await arrange.layout({
                applier, options: layoutOpts
            });
            AreaExtensions.zoomAt(area, editor.getNodes());
        },
        destroy: () => {
            area.destroy();
            panningBoundary?.destroy();
        },
        toPolyAlg: async () => {
            if (editor.getNodes().length === 0) {
                return ['', null];
            }
            const rootId = findRootNodeId(editor.getNodes(), editor.getConnections());
            if (rootId) {
                engine.reset(); // clear cache
                return await engine.fetch(rootId).then(res => [res['out'], editor.getNode(rootId).decl.model]);
            }
            return [null, null];
        },
        onModify: $modifyEvent.asObservable(),
        showMetadata: (b: boolean) => showMetadata(editor, b),
        getTransform: () => area.area.transform
    };
}

function addNode(registry: PolyAlgService, node: PlanNode | null, isReadOnly: boolean, updateSize: (a: AlgNode, delta: Position) => void): [AlgNode[], CustomConnection<AlgNode>[]] {
    const nodes = [];
    const connections = [];
    if (!node) {
        return [nodes, connections];
    }
    const metadata = node.metadata ? new AlgMetadata(node.metadata) : null;
    const algNode = new AlgNode(registry.getDeclaration(node.opName), node.arguments, metadata, false, isReadOnly, updateSize);
    if (node.opName.endsWith('#')) {
        // TODO: handle implicit project correctly
        algNode.label = 'PROJECT#';
    }

    for (let i = 0; i < node.inputs.length; i++) {
        const [childNodes, childConnections] = addNode(registry, node.inputs[i], isReadOnly, updateSize);
        const childNode = childNodes[childNodes.length - 1];
        nodes.push(...childNodes);
        connections.push(...childConnections);

        const targetIn = algNode.hasVariableInputs ? '0' : i.toString();
        connections.push(new CustomConnection(childNode, 'out', algNode, targetIn, childNode.metadata?.outConnection?.width || 0));
    }
    nodes.push(algNode);
    return [nodes, connections];
}

function getContextMenuItems(registry: PolyAlgService, userMode: WritableSignal<UserMode>, planType: PlanType,
                             isReadOnly: boolean, updateSize: (a: AlgNode, delta: Position) => void) {
    const nodes = [];
    for (const model of Object.keys(DataModel).map(key => DataModel[key])) {
        const innerNodes = [];
        for (const decl of registry.getSortedDeclarations(model)) {
            if (decl.tags.includes(OperatorTag[planType])) {
                innerNodes.push([
                    decl.name.substring(decl.name.indexOf('_') + 1),
                    () => new AlgNode(decl, null, null, userMode() === UserMode.SIMPLE, isReadOnly, updateSize)
                ]);
            }
        }
        if (innerNodes.length > 0) {
            nodes.push([model, innerNodes]);
        }
    }


    const items = ContextMenuPresets.classic.setup(nodes);

    // adjust classic preset to hide the search bar and enable cloning (clone handler of the preset is broken)
    return (context: any, plugin: any) => {
        const result = items(context, plugin);
        result.searchBar = false;

        if (result.list[result.list.length - 1].key === 'clone') {
            const area = plugin.parentScope(BaseAreaPlugin);
            const editor = area.parentScope(NodeEditor);
            result.list[result.list.length - 1] = {
                label: 'Clone',
                key: 'clone',
                async handler() {
                    const node = context.clone(context);
                    await editor.addNode(node);
                    area.translate(node.id, area.area.pointer);
                }
            };
        } else if (userMode() === UserMode.SIMPLE) {
            result.list.forEach(item => {
                const model = getModelPrefix(item.label as DataModel);
                item.subitems = item.subitems?.filter(sub => {
                    const opName = `${model}_${sub.label}`;
                    return registry.isSimpleOperator(opName);
                });
            });
        }
        return result;
    };
}

function updateSize(algNode: AlgNode, {x, y}: Position, area: AreaPlugin<Schemes, AreaExtra>,
                    readonlyPlugin: ReadonlyPlugin<Schemes> | null,
                    arrange: () => Promise<any>, $modifyEvent: Subject<void>) {
    const oldPos = area.nodeViews.get(algNode.id).position;

    // update location of sockets
    area.update('node', algNode.id).then(
        () => {
            const isReadOnly = readonlyPlugin != null;
            if (isReadOnly) {
                if (readonlyPlugin.enabled) { // disabled if another node is currently arranging
                    readonlyPlugin.disable();
                    arrange().then(() => readonlyPlugin.enable());
                }

            } else if (x || y) {
                area.translate(algNode.id, {x: oldPos.x + x, y: oldPos.y + y}).then();
                if (y) {
                    $modifyEvent.next(); // height has changed, so the content has probably also changed (e.g. when list item is deleted)
                }
            }
        }
    );
}

function showMetadata(editor: NodeEditor<Schemes>, b: boolean): boolean {
    const nodes = editor.getNodes();
    if (nodes.some(n => n.isMetaVisible() !== b)) {
        nodes.forEach(n => n.isMetaVisible.set(b));
        return b;
    }
    // if setting the metadata to b would have no effect, we toggle all by inverting b
    nodes.forEach(n => n.isMetaVisible.set(!b));
    return !b;

}

export enum UserMode {
    SIMPLE = 'SIMPLE',
    ADVANCED = 'ADVANCED'
}
