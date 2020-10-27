import { CollectionViewer, SelectionChange, DataSource } from "@angular/cdk/collections";
import { FlatTreeControl } from "@angular/cdk/tree";
import { Component, Injectable, Input, OnDestroy, OnInit } from "@angular/core";
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
import { BehaviorSubject, EMPTY, forkJoin, merge, Observable, Subscription } from "rxjs";
import { catchError, map, switchMap } from "rxjs/operators";
export enum NodeType {
  ENTITY = "ENTITY",
  HOLDINGS = "HOLDINGS",
  ITEMS = "ITEMS",
  LOAD = "LOAD",
  OBJECT = "OBJECT",
}
/** Flat node with expandable and level information */
export class DynamicFlatNode {
  constructor(
    public item: Entity | any,
    public stringKey: string = "",
    public stringVal: string = "",
    public type: NodeType,
    public level = 1,
    public expandable = false,
    public isLoading = false
  ) {}
}
const DEF_ITEMS_LIMIT = 4;
const MAX_API_LIMIT = 100;
/**
 * Database for dynamic data. When expanding a node in the tree, the data source will need to fetch
 * the descendants data from the database.
 */
@Injectable({ providedIn: "root" })
export class DynamicDatabase implements OnInit, OnDestroy {
  constructor(
    private eventService: CloudAppEventsService,
    private restService: CloudAppRestService
  ) {}
  ngOnInit() {}

  ngOnDestroy(): void {}

  initialData(pageInfo?: PageInfo): Observable<DynamicFlatNode[]> {
    if (pageInfo) {
      return new Observable<PageInfo>((observer) => {
        observer.next(pageInfo);
        observer.complete();
      }).pipe(map(this.pageToDynamicNodes));
    } else {
      return this.eventService.getPageMetadata().pipe(map(this.pageToDynamicNodes));
    }
  }
  private errorCallback(err: any, caught: Observable<any>) {
    console.error(err);
    return EMPTY;
  }

  private pageToDynamicNodes(pageInfo: PageInfo, level: number = 1): DynamicFlatNode[] {
    let nodes: DynamicFlatNode[] = [];
    for (let entity of pageInfo.entities) {
      if (entity?.type === EntityType.BIB_MMS) {
        nodes.push(
          new DynamicFlatNode(
            entity,
            "Bib",
            entity.id + " " + entity.description,
            NodeType.ENTITY,
            level,
            !!entity.link,
            false
          )
        );
      }
    }
    return nodes;
  }
  getChildren(node: DynamicFlatNode, limit = DEF_ITEMS_LIMIT): Observable<any> {
    switch (node.type) {
      case NodeType.ENTITY:
        return this.restService
          .call(node.item.link)
          .pipe(switchMap((res) => this.restService.call(res.holdings.link)));
      case NodeType.HOLDINGS:
        if (limit < MAX_API_LIMIT) {
          return this.restService.call(node.item.link).pipe(
            catchError(this.errorCallback),
            switchMap((res) =>
              this.restService
                .call(node.item.link + `/items?limit=${limit}`)
                .pipe(catchError(this.errorCallback))
            )
          );
        } else {
          let offset = 0;
          let current = MAX_API_LIMIT;
          let observables = [];
          while (limit > 0) {
            observables.push(
              this.restService.call(node.item.link).pipe(
                catchError(this.errorCallback),
                switchMap((res) =>
                  this.restService
                    .call(node.item.link + `/items?limit=${current}?offset=${offset}`)
                    .pipe(catchError(this.errorCallback))
                )
              )
            );
            offset += current;
            limit -= current;
            current = limit % current;
            console.log("limit", limit, "current", current); //TODO Check that working
          }
          return forkJoin(observables);
        }
      case NodeType.ITEMS:
        return this.restService.call(node.item.link).pipe(catchError(this.errorCallback));
    }
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

  constructor(
    private _treeControl: FlatTreeControl<DynamicFlatNode>,
    private _database: DynamicDatabase
  ) {}

  connect(collectionViewer: CollectionViewer): Observable<DynamicFlatNode[]> {
    this._treeControl.expansionModel.changed.subscribe((change) => {
      if (
        (change as SelectionChange<DynamicFlatNode>).added ||
        (change as SelectionChange<DynamicFlatNode>).removed
      ) {
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

  /**
   * Toggle the node, remove from display list
   */
  toggleNode(node: DynamicFlatNode, expand: boolean) {
    node.isLoading = true;
    this.itemLimits.has(node.stringVal)
      ? null
      : this.itemLimits.set(node.stringVal, DEF_ITEMS_LIMIT);
    this._database.getChildren(node, this.itemLimits.get(node.stringVal)).subscribe({
      next: (children) => {
        this.toggleAfterSubscribed(node, expand, children);
      },
      error: (err: RestErrorResponse) => {
        this.toggleAfterSubscribed(node, expand, {});
        console.error(err);
      },
    });
  }
  private toggleAfterSubscribed(node: DynamicFlatNode, expand: boolean, children: any) {
    const index = this.data.indexOf(node);
    if (!children || index < 0) {
      // If no children, or cannot find the node, no op
      return;
    }
    if (expand) {
      let nodes = [];
      nodes = this.handleNodes(node, nodes, children);
      this.data.splice(index + 1, 0, ...nodes);
    } else {
      let count = 0;
      for (
        let i = index + 1;
        i < this.data.length && this.data[i].level > node.level;
        i++, count++
      ) {}
      this.data.splice(index + 1, count);
    }

    // notify the change
    this.dataChange.next(this.data);
    node.isLoading = false;
  }
  private handleNodes(node: DynamicFlatNode, nodes: any[], children: any) {
    switch (node.type) {
      case NodeType.ENTITY:
        nodes = this.handleEntityNode(children, node);
        break;
      case NodeType.HOLDINGS:
        nodes = this.handleHoldingNode(children, node);
        break;
      case NodeType.ITEMS:
        break;
    }
    return nodes;
  }

  private handleEntityNode(children: any, node: DynamicFlatNode) {
    const nodes = [];
    children.holding.forEach((element) => {
      nodes.push(
        new DynamicFlatNode(
          element,
          "Holdings",
          element.holding_id +
            " " +
            (element?.location?.desc ? element?.location?.desc : "") +
            "/" +
            element?.library?.desc +
            (element?.call_number ? "/" + element.call_number : ""),
          NodeType.HOLDINGS,
          node.level + 1,
          true
        )
      );
    });

    return nodes;
  }
  private handleHoldingNode(children: any, node: DynamicFlatNode) {
    const nodes = [];
    if (Object.keys(children).length === 0) {
      // No Items
      nodes.push(new DynamicFlatNode(null, "", "No Items", NodeType.ITEMS, node.level + 1, false));
    } else {
      children?.item.forEach((element) => {
        nodes.push(
          new DynamicFlatNode(
            element,
            "Item",
            this.formatItem(element),
            NodeType.ITEMS,
            node.level + 1,
            false
          )
        );
      });
      if (children?.total_record_count > this.itemLimits.get(node.stringVal)) {
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

  private formatItem(element: any): string {
    return (
      element.item_data?.barcode +
      (element.item_data?.base_status?.desc ? "/" + element.item_data.base_status.desc : "") +
      (element.item_data?.physical_material_type?.desc
        ? "/" + element.item_data?.physical_material_type?.desc
        : "") +
      `/${element.item_data.pid}`
    );
  }
  public updateLimits(node: DynamicFlatNode) {
    //StringVal of parent is used as a key (is unique)
    let parent = node.item.parent;
    let maxLimit = Math.min(
      node.item.total_record_count + 1,
      this.itemLimits.get(parent.stringVal) * 2
    );
    this.itemLimits.has(parent.stringVal)
      ? this.itemLimits.set(parent.stringVal, maxLimit)
      : this.itemLimits.set(parent.stringVal, DEF_ITEMS_LIMIT * 2);
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
export class BibDynamicTree implements OnDestroy, OnInit {
  icons = new Map<NodeType, string>([
    [NodeType.ENTITY, "bookmarks"],
    [NodeType.HOLDINGS, "bookmark"],
    [NodeType.ITEMS, "book"],
    [NodeType.LOAD, ""],
  ]);
  private pageLoad$: Subscription;
  private database: DynamicDatabase;

  ngOnInit() {
    this.pageLoad$ = this.eventService.onPageLoad((res) => {
      if (res.entities.length > 0) {
        console.log("PageLoad", res);
        this.database.initialData().subscribe({
          next: (nodes) => {
            this.dataSource.data = nodes;
          },
        });
      }
    });
  }
  ngOnDestroy() {
    this.pageLoad$.unsubscribe();
  }

  constructor(database: DynamicDatabase, private eventService: CloudAppEventsService) {
    this.treeControl = new FlatTreeControl<DynamicFlatNode>(this.getLevel, this.isExpandable);
    this.dataSource = new DynamicDataSource(this.treeControl, database);
    this.database = database;

    database.initialData().subscribe({
      next: (nodes) => {
        this.dataSource.data = nodes;
      },
    });
  }

  treeControl: FlatTreeControl<DynamicFlatNode>;

  dataSource: DynamicDataSource;

  getLevel = (node: DynamicFlatNode) => node.level;

  isExpandable = (node: DynamicFlatNode) => node.expandable;

  isNotLoadNode = (_: number, _nodeData: DynamicFlatNode) => _nodeData.type !== NodeType.LOAD;

  hasChild = (_: number, _nodeData: DynamicFlatNode) => _nodeData.expandable;

  isLoad = (_: number, _nodeData: DynamicFlatNode) => {
    let condition = _nodeData.type === NodeType.LOAD;
    if (_nodeData.item.parent && this.dataSource.itemLimits.has(_nodeData.item.parent.stringVal)) {
      condition =
        condition &&
        this.dataSource.itemLimits.get(_nodeData.item.parent.stringVal) <
          _nodeData.item.total_record_count + 1;
    }
    return condition;
  };
  getIcon = (type) => this.icons.get(type);

  onLoadMore(node: DynamicFlatNode) {
    this.dataSource.updateLimits(node);
  }
}
