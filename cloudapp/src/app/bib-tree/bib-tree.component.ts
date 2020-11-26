import { HelperService } from "./../helper-service.service";
import { CollectionViewer, SelectionChange, DataSource } from "@angular/cdk/collections";
import { FlatTreeControl } from "@angular/cdk/tree";
import { Component, ElementRef, EventEmitter, Injectable, Input, OnDestroy, OnInit, Output } from "@angular/core";
import {
  CloudAppEventsService,
  CloudAppRestService,
  Entity,
  EntityType,
  HttpMethod,
  PageInfo,
  Request,
  RestErrorResponse,
} from "@exlibris/exl-cloudapp-angular-lib";
import { BehaviorSubject, EMPTY, forkJoin, merge, Observable, of, Subscription } from "rxjs";
import { catchError, map, switchMap } from "rxjs/operators";

export enum NodeType {
  BIB = "BIB",
  HOLDINGS = "HOLDINGS",
  ITEMS = "ITEMS",
  LOAD = "LOAD",
  OBJECT = "OBJECT",
}
const NODE_DEF_CLASS = "node mat-tree-node hideIcons";
/** Flat node with expandable and level information */
export class DynamicFlatNode {
  constructor(
    public item: Entity | any,
    public stringKey: string = "",
    public stringVal: string = "",
    public type: NodeType,
    public level = 1,
    public expandable = false,
    public isLoading = false,
    public expanded = false,
    public cssClass = NODE_DEF_CLASS
  ) {}
}
const DEF_ITEMS_LIMIT = 4;
const MAX_API_LIMIT = 100;
/**
 * Database for dynamic data. When expanding a node in the tree, the data source will need to fetch
 * the descendants data from the database.
 */
@Injectable({ providedIn: "root" })
export class DynamicDatabase {
  constructor(private restService: CloudAppRestService, private helper: HelperService) {}

  public initialData(entities?: any): Observable<DynamicFlatNode[]> {
    if (entities) {
      return this.pageToDynamicNodes(entities);
    } else {
      return;
    }
  }
  private errorCallback(err: any, caught: Observable<any>) {
    console.error(err);
    return EMPTY;
  }

  public pageToDynamicNodes(entities: any, level: number = 0): Observable<DynamicFlatNode[]> {
    let nodes: DynamicFlatNode[] = [];
    for (let entity of entities) {
      // switch (entity?.type) {
      // case EntityType.BIB_MMS:
      nodes.push(
        new DynamicFlatNode(entity, "Bib", this.helper.formatBibEntity(entity), NodeType.BIB, level, true, false)
      );
      // break;
      // case EntityType.ITEM: // for now item is not expandable
      //   nodes.push(new DynamicFlatNode(entity, "Item", this.helper.formatItem(entity), NodeType.ITEMS, 1, false));
      //   break;
    }
    // }
    return of(nodes);
  }
  getChildren(node: DynamicFlatNode, limit: number, nodes: DynamicFlatNode[], expand: boolean): Observable<any> {
    switch (node.type) {
      case NodeType.BIB:
        return this.restService.call(node.item.holdings.link).pipe(
          map((children) => {
            return this.handleNodes(node, nodes, children);
          })
        );
      case NodeType.HOLDINGS:
        return this.restService.call(node.item.link).pipe(
          catchError(this.errorCallback),
          switchMap((res) =>
            this.restService.call(node.item.link + `/items?limit=${limit}`).pipe(
              catchError(this.errorCallback),
              map((children) => {
                return this.handleNodes(node, nodes, children, limit);
              })
            )
          )
        );
      case NodeType.ITEMS:
        return this.restService.call(node.item.link).pipe(catchError(this.errorCallback));
    }
  }

  private handleNodes(node: DynamicFlatNode, nodes: any[], children: any, limit?: number) {
    switch (node.type) {
      case NodeType.BIB:
        nodes = this.handleBibNode(children, node);
        break;
      case NodeType.HOLDINGS:
        nodes = this.handleHoldingNode(children, node, limit);
        break;
      case NodeType.ITEMS:
        break;
    }
    return nodes;
  }

  private handleBibNode(children: any, node: DynamicFlatNode) {
    const nodes = [];
    if (Object.keys(children).length === 0 || !children.holding) {
      // No holdings
      nodes.push(new DynamicFlatNode(null, "", "No Holdings", NodeType.HOLDINGS, node.level + 1, false));
    } else {
      children.holding.forEach((element) => {
        nodes.push(
          new DynamicFlatNode(
            element,
            "Holdings",
            this.helper.formatHoldings(element),
            NodeType.HOLDINGS,
            node.level + 1,
            true
          )
        );
      });
    }
    return nodes;
  }
  private handleHoldingNode(children: any, node: DynamicFlatNode, limit: number) {
    const nodes = [];
    if (Object.keys(children).length === 0 || !children.item) {
      // No Items
      nodes.push(new DynamicFlatNode(null, "", "No Items", NodeType.ITEMS, node.level + 1, false));
    } else {
      children?.item.forEach((element) => {
        nodes.push(
          new DynamicFlatNode(element, "Item", this.helper.formatItem(element), NodeType.ITEMS, node.level + 1, false)
        );
      });
      if (children?.total_record_count > limit) {
        nodes.push(
          new DynamicFlatNode(
            { parent: node, total_record_count: children.total_record_count }, //The item on load more is the parent node
            "",
            `Load more .. (Total of ${children.total_record_count})`,
            NodeType.LOAD,
            node.level + 1,
            false
          )
        );
      }
    }
    return nodes;
  }

  isExpandable(node: DynamicFlatNode): boolean {
    return node.expandable;
  }
}
/**
 * File database, it can build a tree structured Json object from string.
 * Each node in Json object represents a file or a directory. For a file, it has filename and type.
 * For a directory, it has filename and children (a list of files or directories).
 * The input will be a json object string, and the output is a list of `FileNode` with nested
 * structure.
 */
export class DynamicDataSource implements DataSource<DynamicFlatNode> {
  dataChange = new BehaviorSubject<DynamicFlatNode[]>([]);
  itemLimits = new Map<string, number>();

  get data(): DynamicFlatNode[] {
    return this.dataChange.value;
  }
  set data(value: DynamicFlatNode[]) {
    this._treeControl.dataNodes = value;
    this.dataChange.next(value);
  }

  constructor(private _treeControl: FlatTreeControl<DynamicFlatNode>, public _database: DynamicDatabase) {}

  connect(collectionViewer: CollectionViewer): Observable<DynamicFlatNode[]> {
    this._treeControl.expansionModel.changed.subscribe((change) => {
      if ((change as SelectionChange<DynamicFlatNode>).added || (change as SelectionChange<DynamicFlatNode>).removed) {
        this.handleTreeControl(change as SelectionChange<DynamicFlatNode>);
      }
    });

    return merge(collectionViewer.viewChange, this.dataChange).pipe(map(() => this.data));
  }

  disconnect(collectionViewer: CollectionViewer): void {}

  /** Handle expand/collapse behaviors */
  handleTreeControl(change: SelectionChange<DynamicFlatNode>) {
    if (change.added) {
      change.added.forEach((node) => this.toggleNode(node, true));
    }
    if (change.removed) {
      change.removed
        .slice()
        .reverse()
        .forEach((node) => this.toggleNode(node, false));
    }
  }
  initialData(page) {
    return this._database.initialData(page);
  }
  /**
   * Toggle the node, remove from display list
   */
  toggleNode(node: DynamicFlatNode, expand: boolean, fullyExpand?: boolean) {
    node.isLoading = true;
    if (!expand) {
      this.toggleAfterSubscribed(node, expand, []);
    }
    this.itemLimits.has(node.stringVal) ? null : this.itemLimits.set(node.stringVal, DEF_ITEMS_LIMIT);
    if (fullyExpand) {
      expand ? this.itemLimits.set(node.stringVal, 999) : this.itemLimits.set(node.stringVal, DEF_ITEMS_LIMIT);
    }
    let nodes: DynamicFlatNode[] = [];
    this._database.getChildren(node, this.itemLimits.get(node.stringVal), nodes, expand).subscribe({
      next: (nodes) => {
        this.toggleAfterSubscribed(node, expand, nodes);
      },
      error: (err: RestErrorResponse) => {
        // this.toggleAfterSubscribed(node, expand, []);
        console.error(err);
      },
    });
  }
  private toggleAfterSubscribed(node: DynamicFlatNode, expand: boolean, nodes: DynamicFlatNode[]) {
    const index = this.data.indexOf(node);
    if (index < 0) {
      // If  cannot find the node, no op
      return;
    }
    if (expand) {
      node.expanded = true;
      this.data.splice(index + 1, 0, ...nodes);
    } else {
      node.expanded = false;
      let count = 0;
      for (let i = index + 1; i < this.data.length && this.data[i].level > node.level; i++, count++) {}
      this.data.splice(index + 1, count);
    }

    // notify the change
    this.dataChange.next(this.data);
    node.isLoading = false;
  }

  public updateLimits(node: DynamicFlatNode, fullyExpand: boolean) {
    let multiplier = fullyExpand ? 1000 : 2;
    //StringVal of parent is used as a key (is unique)
    let parent = node.item.parent;
    let maxLimit = Math.min(node.item.total_record_count + 1, this.itemLimits.get(parent.stringVal) * multiplier);
    this.itemLimits.has(parent.stringVal)
      ? this.itemLimits.set(parent.stringVal, maxLimit)
      : this.itemLimits.set(parent.stringVal, DEF_ITEMS_LIMIT * multiplier);
    this.toggleNode(parent, false);
    this.toggleNode(parent, true);
  }
}

/**
 * @title Tree with dynamic data
 */
@Component({
  selector: "app-bib-tree",
  templateUrl: "bib-tree.component.html",
  styleUrls: ["bib-tree.component.scss"],
})
export class BibDynamicTree implements OnDestroy {
  public loading: boolean = false;
  @Output("noNodes") noNodes = new EventEmitter<boolean>();
  icons = new Map<NodeType, string>([
    [NodeType.BIB, "bookmarks"],
    [NodeType.HOLDINGS, "bookmark"],
    [NodeType.ITEMS, "book"],
    [NodeType.LOAD, ""],
  ]);
  private pageLoad$: Subscription;
  // private database:DynamicDatabase;
  ngOnInit() {
    this.pageLoad$ = this.eventService.onPageLoad(this.onPageLoad);
  }
  ngOnDestroy() {
    this.pageLoad$.unsubscribe();
  }

  constructor(
    public database: DynamicDatabase,
    private eventService: CloudAppEventsService,
    private restService: CloudAppRestService
  ) {
    this.treeControl = new FlatTreeControl<DynamicFlatNode>(this.getLevel, this.isExpandable);
    this.dataSource = new DynamicDataSource(this.treeControl, database);
  }

  treeControl: FlatTreeControl<DynamicFlatNode>;

  dataSource: DynamicDataSource;
  /**
   * Method that handles new page loads, get there record using api and passing it to the database
   */
  onPageLoad = (res: PageInfo) => {
    if (res.entities.length > 0) {
      console.log("PageLoad", res);
      if (res) {
        of(res)
          .pipe(
            switchMap((pageInfo: PageInfo) => {
              let observables = [];
              let linkSet = new Set<string>(); // To remove duplicates 
              let re: RegExp = new RegExp("/bibs/[0-9]+");
              for (let entity of pageInfo.entities) {
                linkSet.add(re.exec(entity.link)[0])
              }
              for (const link of Array.from(linkSet.values()))
              {
                            observables.push(
                  this.restService.call(link).pipe(
                    map((res) => {
                      return { ...res};
                    })
                  )
                );
              }
  
              return forkJoin(observables);
            }),
            switchMap((res) => {
              return this.dataSource.initialData(res);
            })
          )
          .subscribe({
            next: (nodes) => {
              if (nodes.length === 0) {
                this.noNodes.emit(false);
              } else {
                this.noNodes.emit(true);
              }
              this.dataSource.data = nodes;
            },
          });
      }
    }
  };

  onHover(node: DynamicFlatNode, show: boolean) {
    
    if (show && node.cssClass.search('hideIcons')) {
      node.cssClass = node.cssClass.replace("hideIcons", "showIcons");
    }else if (!show && node.cssClass.search('showIcons'))
    {
      node.cssClass = node.cssClass.replace("showIcons","hideIcons");
    }
    console.log(node.cssClass)
  }
  getLevel = (node: DynamicFlatNode) => node.level;

  isExpandable = (node: DynamicFlatNode) => node.expandable;

  isNotLoadNode = (_: number, _nodeData: DynamicFlatNode) => _nodeData.type !== NodeType.LOAD;

  hasChild = (_: number, _nodeData: DynamicFlatNode) => _nodeData.expandable;

  isLoad = (_: number, _nodeData: DynamicFlatNode) => {
    if (_nodeData && _ && _nodeData.item) {
      let condition = _nodeData.type === NodeType.LOAD;
      if (_nodeData.item.parent && this.dataSource.itemLimits.has(_nodeData.item.parent.stringVal)) {
        condition =
          condition &&
          this.dataSource.itemLimits.get(_nodeData.item.parent.stringVal) < _nodeData.item.total_record_count + 1;
      }
      return condition;
    }
    return false;
  };
  getIcon = (type) => this.icons.get(type);

  onLoadMore(node: DynamicFlatNode, fully?: boolean) {
    this.dataSource.updateLimits(node, fully);
  }
  fullyExpandNode(node: DynamicFlatNode) {
    this.loading = true;
    this.recFullyExpandNode(node);
    let time = node.expanded ? 0 : 3000; //Takes more time to open than close
    setTimeout(() => (this.loading = false), time);
  }
  recFullyExpandNode(node: DynamicFlatNode) {
    if (this.isExpandable(node)) {
      this.treeControl.toggle(node);
      let data = this.dataSource.data;
      let index = data.indexOf(node);
      setTimeout(() => {
        for (let i = index + 1; i < data.length && data[i].level > node.level; i++) {
          if (this.isLoad(i, data[i])) {
            this.onLoadMore(data[i], true);
          } else {
            this.recFullyExpandNode(data[i]);
          }
        }
      }, 1000);
    }
  }
  onScreenPrint() {
    window.print();
  }
  onNodePrint(node: DynamicFlatNode, nodeEl: any) {
    this.loading = true;

    this.recChangeChildrenClass(node, "node mat-tree-node hideIcons printMe");
    this.changeNodeClasses(node);
    setTimeout(() => {
      window.print();
      for (let j = 0; j < this.dataSource.data.length; j++) {
        this.dataSource.data[j].cssClass = NODE_DEF_CLASS;
      }
      this.loading = false;
    }, 1000);
  }
  /**
   * Method That changes the other nodes but childes class to hidden
   */
  private changeNodeClasses(node: DynamicFlatNode) {
    const index = this.dataSource.data.indexOf(node);
    let i = 0;
    for (i = index + 1; i < this.dataSource.data.length && this.dataSource.data[i].level > node.level; i++) {}
    for (let j = 0; j < this.dataSource.data.length; j++) {
      if (!(j >= index && j < i)) {
        this.dataSource.data[j].cssClass = "hiddenClass node mat-tree-node";
      }
    }
  }
  /**
   * Changes the child of node to the given class name
   */
  private recChangeChildrenClass(node: DynamicFlatNode, className: string) {
    node.cssClass = className;
    if (this.isExpandable(node)) {
      let data = this.dataSource.data;
      let index = data.indexOf(node);
      for (let i = index + 1; i < data.length && data[i].level === node.level + 1; i++) {
        this.recChangeChildrenClass(data[i], className);
      }
    }
  }
}
