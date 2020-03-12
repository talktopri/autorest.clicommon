import { Host, Session, startSession } from "@azure-tools/autorest-extension-base";
import { serialize } from "@azure-tools/codegen";
import { CodeModel, codeModelSchema, Metadata, ObjectSchema, isObjectSchema, Property, Extensions } from "@azure-tools/codemodel";
import { isNullOrUndefined, isArray } from "util";
import { DESTRUCTION } from "dns";
import { Helper } from "../../helper";
import { CliConst } from "../../schema";
import { CliDirectiveManager } from "../modifier/cliDirective";
import { Modifier } from "../modifier/modifier";
import { FlattenValidator } from "./flattenValidator";
import { values } from "@azure-tools/linq";

export class FlattenSetter {
    codeModel: CodeModel;
    cliConfig: any;
    manager: CliDirectiveManager;

    constructor(protected session: Session<CodeModel>) {
        this.codeModel = session.model;
    }

    async process(host: Host) {

        let overwriteSwagger = await this.session.getValue(CliConst.CLI_FLATTEN_SET_FLATTEN_ALL_OVERWRITE_SWAGGER_KEY, false);
        let flattenAll = await this.session.getValue(CliConst.CLI_FLATTEN_SET_FLATTEN_ALL_KEY, false);

        let flattenSchema = await this.session.getValue(CliConst.CLI_FLATTEN_SET_FLATTEN_SCHEMA_KEY, false);

        // by default on when the flatten_all flag is one
        if (flattenSchema === true || flattenAll === true) {
            this.codeModel.schemas.objects.forEach(o => {
                if (!Helper.isBaseClass(o)) {
                    if (!isNullOrUndefined(o.properties)) {
                        o.properties.forEach(p => {
                            if (isObjectSchema(p.schema)) {
                                if (isNullOrUndefined(p.extensions))
                                    p.extensions = {};

                                if (isNullOrUndefined(p.extensions[CliConst.FLATTEN_FLAG]) || overwriteSwagger)
                                    p.extensions[CliConst.FLATTEN_FLAG] = !Helper.isBaseClass(p.schema as ObjectSchema);
                            }
                        })
                    }
                }
            });
        }

        let flattenPayload = await this.session.getValue(CliConst.CLI_FLATTEN_SET_FLATTEN_PAYLOAD_KEY, false);
        if (flattenPayload === true || flattenAll === true) {
            this.codeModel.operationGroups.forEach(group => {
                group.operations.forEach(operation => {
                    const body = values(operation.request.parameters).first(p => p.protocol.http?.in === 'body' && p.implementation === 'Method');
                    if (!isNullOrUndefined(body))
                        Helper.setFlatten(body, true);
                })
            })
        }

        return this.codeModel;
    }
}

export async function processRequest(host: Host) {
    let debugOutput = {};

    const session = await startSession<CodeModel>(host, {}, codeModelSchema);
    Helper.init(session);

    let cliDebug = await session.getValue('debug', false);
    let flag = await session.getValue(CliConst.CLI_FLATTEN_SET_ENABLED_KEY, false);


    if (flag !== true) {
        Helper.logWarning(`'${CliConst.CLI_FLATTEN_SET_ENABLED_KEY}' is not set to true, skip flattenSetter`);
    }
    else {

        if (cliDebug) {
            debugOutput['cli-flatten-set-before-everything.yaml'] = serialize(session.model);
            debugOutput['cli-flatten-set-before-everything-simplified.yaml'] = Helper.toYamlSimplified(session.model);
        }

        let m4FlattenModels = await session.getValue('modelerfour.flatten-models', false);
        if (m4FlattenModels !== true)
            Helper.logWarning('modelerfour.flatten-models is not turned on');
        let m4FlattenPayloads = await session.getValue('modelerfour.flatten-payloads', false);
        if (m4FlattenPayloads !== true)
            Helper.logWarning('modelerfour.flatten-payloads is not turned on');

        const plugin = await new FlattenSetter(session);
        let flatResult = await plugin.process(host);

        if (cliDebug) {
            debugOutput['cli-flatten-set-after-flatten-set.yaml'] = serialize(flatResult);
            debugOutput['cli-flatten-set-after-flatten-set-simplified.yaml'] = Helper.toYamlSimplified(flatResult);
        }

        let directives = await session.getValue(CliConst.CLI_FLATTEN_DIRECTIVE_KEY, null);
        if (!isNullOrUndefined(directives) && isArray(directives) && directives.length > 0) {
            const modifier = await new Modifier(session).init(directives);
            let modResult: CodeModel = modifier.process();
            if (cliDebug) {
                debugOutput['cli-flatten-set-after-modifier.yaml'] = serialize(modResult);
                debugOutput['cli-flatten-set-after-modifier-simplified.yaml'] = Helper.toYamlSimplified(modResult);
            }
        }

    }
    let finalMapping = new FlattenValidator(session).validate(session.model.schemas.objects)
    if (cliDebug) {
        debugOutput['cli-flatten-set-flatten-mapping.txt'] = finalMapping;
    }

    // write the final result first which is hardcoded in the Session class to use to build the model..
    // overwrite the modelerfour which should be fine considering our change is backward compatible
    const options = <any>await session.getValue('modelerfour', {});
    if (options['emit-yaml-tags'] !== false) {
        host.WriteFile('code-model-v4.yaml', serialize(session.model, codeModelSchema), undefined, 'code-model-v4');
    }
    if (options['emit-yaml-tags'] !== true) {
        host.WriteFile('code-model-v4-no-tags.yaml', serialize(session.model), undefined, 'code-model-v4-no-tags');
    }

    for (let key in debugOutput)
        host.WriteFile(key, debugOutput[key], null);
}